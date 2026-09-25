import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { DELETE } from "@/app/api/account/delete/route";
import * as dbModule from "@/lib/db";
import * as authModule from "@/lib/auth-helpers";
import { createMockClient } from "./test-utils";

// Mock DB
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

// Mock auth
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

function makeDeleteRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/account/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/account/delete", () => {
  let mockReadClient: ReturnType<typeof createMockClient>;
  let mockWriteClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadClient = createMockClient();
    mockWriteClient = createMockClient();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockReadClient as unknown as ReturnType<typeof dbModule.getDbRead> extends Promise<infer T> ? T : never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockWriteClient as unknown as ReturnType<typeof dbModule.getDbWrite> extends Promise<infer T> ? T : never);
  });

  describe("authentication", () => {
    it("should return 401 when not authenticated", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce(null);

      const res = await DELETE(makeDeleteRequest({ confirm_email: "test@example.com" }));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should reject deletion with API key authentication", async () => {
      const response = await DELETE(
        new Request("http://localhost/api/account/delete", {
          method: "DELETE",
          headers: {
            Authorization: "Bearer pk_test_key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ confirm_email: "test@example.com" }),
        })
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("browser session");
    });
  });

  describe("validation", () => {
    it("should return 400 when confirm_email is missing", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });

      const res = await DELETE(makeDeleteRequest({}));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("confirm_email is required");
    });

    it("should return 400 when confirm_email is empty", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });

      const res = await DELETE(makeDeleteRequest({ confirm_email: "   " }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("confirm_email is required");
    });

    it("should return 400 when confirm_email does not match", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce({
        id: "u1",
        email: "user@example.com",
        name: null,
        image: null,
        email_verified: null,
      });

      const res = await DELETE(makeDeleteRequest({ confirm_email: "wrong@example.com" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Email does not match. Account deletion cancelled.");
    });

    it("should match email case-insensitively", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce({
        id: "u1",
        email: "User@Example.com",
        name: null,
        image: null,
        email_verified: null,
      });
      mockWriteClient.execute.mockResolvedValue({ results: [] });

      const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.COM" }));

      expect(res.status).toBe(200);
    });
  });

  describe("user not found", () => {
    it("should return 404 when user does not exist", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce(null);

      const res = await DELETE(makeDeleteRequest({ confirm_email: "test@example.com" }));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("User not found");
    });
  });

  describe("atomic deletion", () => {
    it.each([false, true])("removes frozen contributions and rolls back on late failure=%s", async (fail) => {
      const db = new DatabaseSync(":memory:");
      try {
        db.exec(`PRAGMA foreign_keys = ON;
          CREATE TABLE users (id TEXT PRIMARY KEY);
          INSERT INTO users VALUES ('u1'), ('u2');
          CREATE TABLE season_snapshots (season_id TEXT, team_id TEXT, rank INTEGER, total_tokens INTEGER,
            input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER);
          CREATE TABLE season_member_snapshots (season_id TEXT, team_id TEXT, user_id TEXT REFERENCES users(id),
            total_tokens INTEGER, input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER);
          INSERT INTO season_snapshots VALUES ('s1', 't1', 1, 100, 60, 30, 10), ('s1', 't2', 2, 40, 20, 15, 5);
          INSERT INTO season_member_snapshots VALUES ('s1', 't1', 'u1', 100, 60, 30, 10), ('s1', 't2', 'u2', 40, 20, 15, 5);
          CREATE TABLE invite_codes (created_by TEXT REFERENCES users(id), used_by TEXT);
          INSERT INTO invite_codes VALUES ('u1', NULL), ('u2', 'u1');`);
        const tables = ["usage_details", "usage_evidence", "usage_records", "session_records", "team_members",
          "season_team_members", "device_aliases", "sessions", "accounts", "organization_members", "auth_codes"];
        for (const table of tables) db.exec(`CREATE TABLE ${table} (user_id TEXT REFERENCES users(id)); INSERT INTO ${table} VALUES ('u1'), ('u2')`);
        if (fail) db.exec("CREATE TABLE owned_resource (created_by TEXT REFERENCES users(id)); INSERT INTO owned_resource VALUES ('u1')");
        vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
        mockReadClient.getUserById.mockResolvedValueOnce({ id: "u1", email: "user@example.com" });
        mockWriteClient.batch.mockImplementation(async (statements: Array<{ sql: string; params?: string[] }>) => {
          db.exec("BEGIN");
          try {
            const results = statements.map(({ sql, params }) => ({ results: db.prepare(sql).all(...(params ?? [])), meta: { changes: 0, duration: 0 } }));
            db.exec("COMMIT");
            return results;
          } catch (error) { db.exec("ROLLBACK"); throw error; }
        });
        const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.com" }));
        expect(res.status).toBe(fail ? 409 : 200);
        expect(db.prepare("SELECT * FROM users ORDER BY id").all()).toEqual(fail ? [{ id: "u1" }, { id: "u2" }] : [{ id: "u2" }]);
        expect(db.prepare("SELECT * FROM season_snapshots WHERE team_id = 't1'").get()).toEqual({
          season_id: "s1", team_id: "t1", rank: fail ? 1 : 2, total_tokens: fail ? 100 : 0,
          input_tokens: fail ? 60 : 0, output_tokens: fail ? 30 : 0, cached_input_tokens: fail ? 10 : 0,
        });
        expect(db.prepare("SELECT rank, total_tokens FROM season_snapshots WHERE team_id = 't2'").get()).toEqual({ rank: fail ? 2 : 1, total_tokens: 40 });
        for (const table of tables) expect(db.prepare(`SELECT user_id FROM ${table} ORDER BY user_id`).all()).toEqual(fail ? [{ user_id: "u1" }, { user_id: "u2" }] : [{ user_id: "u2" }]);
        expect(db.prepare("SELECT * FROM invite_codes WHERE created_by = 'u2'").get()).toEqual({ created_by: "u2", used_by: fail ? "u1" : "deleted-user" });
        expect(db.prepare("SELECT COUNT(*) AS n FROM invite_codes WHERE used_by IS NULL").get()!.n).toBe(fail ? 1 : 0);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { db.close(); }
    });

    it("fails closed when a required table or write fails", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce({ id: "u1", email: "user@example.com" });
      mockWriteClient.batch.mockRejectedValueOnce(new Error("no such table"));
      const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.com" }));
      expect(res.status).toBe(500);
      expect(mockWriteClient.execute).not.toHaveBeenCalled();
    });
  });
});

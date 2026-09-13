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

  describe("successful deletion", () => {
    it.each([0, 1])("deletes an account without retired tables, preserving other users with foreign_keys=%i", async (foreignKeys) => {
      const db = new DatabaseSync(":memory:");
      try {
        db.exec(`PRAGMA foreign_keys = ${foreignKeys};
          CREATE TABLE users (id TEXT PRIMARY KEY);
          CREATE TABLE usage_evidence (
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            device_id TEXT, event_id TEXT);
          INSERT INTO users VALUES ('u1'), ('u2');
          INSERT INTO usage_evidence VALUES ('u1', 'd1', 'a'), ('u1', 'd2', 'b'), ('u2', 'd1', 'c');`);
        const userTables = ["usage_records", "session_records", "team_members", "season_member_snapshots",
          "season_team_members", "user_budgets", "device_aliases", "sessions", "accounts"];
        for (const table of userTables) {
          db.exec(`CREATE TABLE ${table} (user_id TEXT REFERENCES users(id));
            INSERT INTO ${table} VALUES ('u1'), ('u2');`);
        }
        db.exec("CREATE TABLE invite_codes (created_by TEXT); INSERT INTO invite_codes VALUES ('u1'), ('u2');");
        vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
        mockReadClient.getUserById.mockResolvedValueOnce({ id: "u1", email: "user@example.com" });
        // Execute every statement; any lingering reference to a retired table fails.
        mockWriteClient.execute.mockImplementation(async (sql: string, params: string[]) => {
          db.prepare(sql).run(...params);
          return { results: [] };
        });

        const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.com" }));

        expect(res.status).toBe(200);
        expect(db.prepare("SELECT * FROM usage_evidence").all()).toEqual([
          { user_id: "u2", device_id: "d1", event_id: "c" },
        ]);
        expect(db.prepare("SELECT id FROM users").all()).toEqual([{ id: "u2" }]);
        for (const table of userTables) {
          expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([{ user_id: "u2" }]);
        }
        expect(db.prepare("SELECT * FROM invite_codes").all()).toEqual([
          { created_by: "deleted-user" }, { created_by: "u2" },
        ]);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { db.close(); }
    });

    it("should delete all user data and return success", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce({
        id: "u1",
        email: "user@example.com",
        name: null,
        image: null,
        email_verified: null,
      });
      mockWriteClient.execute.mockResolvedValue({ results: [] });

      const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.com" }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify deletion order (children first)
      const executeCalls = mockWriteClient.execute.mock.calls;
      expect(executeCalls.length).toBeGreaterThanOrEqual(10);

      // Check some key deletions happened
      const sqls = executeCalls.map((call) => call[0]);
      expect(sqls.some((sql: string) => sql.includes("DELETE FROM usage_records"))).toBe(true);
      expect(sqls.some((sql: string) => sql.includes("DELETE FROM session_records"))).toBe(true);
      expect(sqls.some((sql: string) => sql.includes("DELETE FROM team_members"))).toBe(true);
      expect(sqls.some((sql: string) => sql.includes("DELETE FROM sessions"))).toBe(true);
      expect(sqls.some((sql: string) => sql.includes("DELETE FROM accounts"))).toBe(true);
      expect(sqls.some((sql: string) => sql.includes("DELETE FROM users"))).toBe(true);

      // Verify invite_codes are updated, not deleted
      expect(sqls.some((sql: string) => sql.includes("UPDATE invite_codes"))).toBe(true);
    });
  });

  describe("error handling", () => {
    it("does not delete the user or report success when evidence deletion fails", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce({ id: "u1", email: "user@example.com" });
      mockWriteClient.execute.mockImplementation(async (sql: string) => {
        if (sql.includes("usage_evidence")) throw new Error("Synthetic deletion failure");
        return { results: [] };
      });

      const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.com" }));

      expect(res.status).toBe(500);
      expect(mockWriteClient.execute.mock.calls.some(([sql]) => /^DELETE FROM users\b/.test(sql))).toBe(false);
    });

    it("should return 500 on database error", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce({
        id: "u1",
        email: "user@example.com",
        name: null,
        image: null,
        email_verified: null,
      });
      mockWriteClient.execute.mockRejectedValueOnce(new Error("DB error"));

      const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.com" }));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to delete account");
    });

    it("should handle missing optional tables gracefully", async () => {
      vi.mocked(authModule.resolveUser).mockResolvedValueOnce({ userId: "u1" });
      mockReadClient.getUserById.mockResolvedValueOnce({
        id: "u1",
        email: "user@example.com",
        name: null,
        image: null,
        email_verified: null,
      });

      // First few succeed, then season tables fail (they may not exist)
      mockWriteClient.execute.mockImplementation(async (sql: string) => {
        if (sql.includes("season_member_snapshots") || sql.includes("season_team_members") || sql.includes("device_aliases")) {
          throw new Error("no such table");
        }
        return { results: [] };
      });

      const res = await DELETE(makeDeleteRequest({ confirm_email: "user@example.com" }));

      // Should still succeed despite some tables missing
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });
});

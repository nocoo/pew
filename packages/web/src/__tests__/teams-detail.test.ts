import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createMockDbRead, createMockDbWrite, loadMockedAuthHelpers } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/r2", () => ({
  deleteTeamLogoByUrl: vi.fn(),
}));

vi.mock("@/lib/season-roster", () => ({
  syncSeasonRosters: vi.fn(),
}));

import * as dbModule from "@/lib/db";

const { resolveUser } = await loadMockedAuthHelpers();

function makeRequest(method: string, body?: Record<string, unknown>): Request {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost:7020/api/teams/t1", init);
}

function makeParams(teamId = "t1") {
  return { params: Promise.resolve({ teamId }) };
}

// ---------------------------------------------------------------------------
// GET /api/teams/[teamId]
// ---------------------------------------------------------------------------

describe("GET /api/teams/[teamId]", () => {
  let GET: (req: Request, ctx: { params: Promise<{ teamId: string }> }) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    const mod = await import("@/app/api/teams/[teamId]/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(401);
  });

  it("should return 403 when user is not a member", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce(null); // no membership

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should return 404 when team not found", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member"); // membership exists
    mockDbRead.getTeamById.mockResolvedValueOnce(null); // team not found

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(404);
  });

  it("should return team details with members", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamById.mockResolvedValueOnce({
      id: "t1",
      name: "Team Alpha",
      slug: "team-alpha",
      invite_code: "abc12345",
      created_at: "2026-01-01T00:00:00Z",
      logo_url: null,
      auto_register_season: null,
    });
    mockDbRead.getTeamMembers.mockResolvedValueOnce([
      {
        user_id: "u1",
        name: "Alice",
        nickname: "ali",
        slug: null,
        image: null,
        role: "owner",
        joined_at: "2026-01-01T00:00:00Z",
      },
      {
        user_id: "u2",
        name: "Bob",
        nickname: null,
        slug: null,
        image: "https://example.com/bob.png",
        role: "member",
        joined_at: "2026-01-02T00:00:00Z",
      },
    ]);
    mockDbRead.getTeamSeasonRegistrations.mockResolvedValueOnce([]); // season registrations

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("Team Alpha");
    expect(body.role).toBe("owner");
    expect(body.members).toHaveLength(2);
    // nickname takes precedence over name
    expect(body.members[0].name).toBe("ali");
    expect(body.members[1].name).toBe("Bob"); // falls back to name
  });

  it("should handle getTeamMembers returning members without nickname", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");
    mockDbRead.getTeamById.mockResolvedValueOnce({
      id: "t1",
      name: "Team",
      slug: "team",
      invite_code: "x",
      created_at: "2026-01-01T00:00:00Z",
      logo_url: null,
      auto_register_season: null,
    });
    mockDbRead.getTeamMembers.mockResolvedValueOnce([
      {
        user_id: "u1",
        name: "Alice",
        nickname: null,
        slug: null,
        image: null,
        role: "owner",
        joined_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mockDbRead.getTeamSeasonRegistrations.mockResolvedValueOnce([]);

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    // nickname should be null, so name field uses u.name
    expect(body.members[0].name).toBe("Alice");
  });

  it("should handle auto_register_season being null", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");
    mockDbRead.getTeamById.mockResolvedValueOnce({
      id: "t1",
      name: "Team",
      slug: "team",
      invite_code: "x",
      created_at: "2026-01-01T00:00:00Z",
      logo_url: null,
      auto_register_season: null,
    });
    mockDbRead.getTeamMembers.mockResolvedValueOnce([
      {
        user_id: "u1",
        name: "Alice",
        nickname: null,
        slug: null,
        image: null,
        role: "owner",
        joined_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mockDbRead.getTeamSeasonRegistrations.mockResolvedValueOnce([]);

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    // auto_register_season should default to false when null
    expect(body.auto_register_season).toBe(false);
  });

  it("should rethrow errors from getTeamById", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");
    // Team query fails with unexpected error
    mockDbRead.getTeamById.mockRejectedValueOnce(new Error("D1 connection failed"));

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(500);
  });

  it("should return 503 when teams table does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockRejectedValueOnce(
      new Error("no such table: team_members"),
    );

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(503);
  });

  it("should strip invite_code for non-owner member", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u2" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");
    mockDbRead.getTeamById.mockResolvedValueOnce({
      id: "t1",
      name: "Team",
      slug: "team",
      invite_code: "secret-code",
      created_at: "2026-01-01T00:00:00Z",
      logo_url: "https://r2.example.com/logo.png",
      auto_register_season: 1,
    });
    mockDbRead.getTeamMembers.mockResolvedValueOnce([]);
    mockDbRead.getTeamSeasonRegistrations.mockResolvedValueOnce(["s1"]);

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    // invite_code should NOT be present for non-owner
    expect(body.invite_code).toBeUndefined();
    // logoUrl should be mapped
    expect(body.logoUrl).toBe("https://r2.example.com/logo.png");
    // auto_register_season truthy → true
    expect(body.auto_register_season).toBe(true);
    expect(body.registered_season_ids).toEqual(["s1"]);
  });

  it("should include invite_code for owner", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamById.mockResolvedValueOnce({
      id: "t1",
      name: "Team",
      slug: "team",
      invite_code: "secret-code",
      created_at: "2026-01-01T00:00:00Z",
      logo_url: null,
      auto_register_season: null,
    });
    mockDbRead.getTeamMembers.mockResolvedValueOnce([]);
    mockDbRead.getTeamSeasonRegistrations.mockResolvedValueOnce([]);

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.invite_code).toBe("secret-code");
  });

  it("should gracefully handle season registration table missing (non-table error logged)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamById.mockResolvedValueOnce({
      id: "t1",
      name: "Team",
      slug: "team",
      invite_code: "x",
      created_at: "2026-01-01T00:00:00Z",
      logo_url: null,
      auto_register_season: null,
    });
    mockDbRead.getTeamMembers.mockResolvedValueOnce([]);
    // Non "no such table" error — should be logged but not crash
    mockDbRead.getTeamSeasonRegistrations.mockRejectedValueOnce(new Error("D1 timeout"));

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.registered_season_ids).toEqual([]);
  });

  it("should gracefully handle season registration table not existing", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamById.mockResolvedValueOnce({
      id: "t1",
      name: "Team",
      slug: "team",
      invite_code: "x",
      created_at: "2026-01-01T00:00:00Z",
      logo_url: null,
      auto_register_season: null,
    });
    mockDbRead.getTeamMembers.mockResolvedValueOnce([]);
    mockDbRead.getTeamSeasonRegistrations.mockRejectedValueOnce(new Error("no such table: season_teams"));

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.registered_season_ids).toEqual([]);
  });

  it("should return 500 on unexpected error in GET", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");
    mockDbRead.getTeamById.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/teams/[teamId] — leave team
// ---------------------------------------------------------------------------

describe("DELETE /api/teams/[teamId]", () => {
  let DELETE: (req: Request, ctx: { params: Promise<{ teamId: string }> }) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/teams/[teamId]/route");
    DELETE = mod.DELETE;
  });

  it("should reject unauthenticated with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(401);
  });

  it("should return 403 when user is not a member", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce(null); // no membership

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(403);
  });

  it("should prevent owner from leaving when other members exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner"); // membership
    mockDbRead.countTeamMembers.mockResolvedValueOnce(3); // 3 members

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Transfer ownership");
  });

  it("should allow non-owner to leave (team persists)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u2" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member"); // not owner
    mockDbRead.countTeamMembers.mockResolvedValueOnce(3); // 3 members
    mockDbWrite.batch.mockResolvedValue([{ results: [{ user_id: "u2" }], meta: { changes: 1, duration: 0 } }]);

    const res = await DELETE(makeRequest("DELETE"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Should only delete membership, NOT the team
    expect(mockDbWrite.execute).not.toHaveBeenCalled();
    expect(mockDbWrite.batch.mock.calls[0]![0][0]!.sql).toContain("DELETE FROM team_members");
  });

  it("should delete team when last member leaves", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.countTeamMembers.mockResolvedValueOnce(1); // last member
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(null);
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockDbWrite.batch.mockResolvedValue([{ results: [{ user_id: "u1" }], meta: { changes: 1, duration: 0 } }, { results: [], meta: { changes: 0, duration: 0 } }, { results: [], meta: { changes: 0, duration: 0 } }, { results: [{ logo_url: "https://r2.example.com/logo.png" }], meta: { changes: 1, duration: 0 } }]);

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(200);
    expect(mockDbWrite.execute).not.toHaveBeenCalled();
    expect(mockDbWrite.batch.mock.calls[0]![0][0]!.sql).toContain("DELETE FROM team_members");
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
    const batchCalls = mockDbWrite.batch.mock.calls[0]![0] as Array<{ sql: string }>;
    expect(batchCalls.some((s) => s.sql.includes("DELETE FROM season_teams"))).toBe(true);
    expect(batchCalls.some((s) => s.sql.includes("DELETE FROM teams"))).toBe(true);
    // Should NOT delete season_roster_snapshots (historical data)
    expect(batchCalls.some((s) => s.sql.includes("DELETE FROM season_roster_snapshots"))).toBe(false);
  });

  it("should delete team logo when last member leaves and logo exists", async () => {
    const { deleteTeamLogoByUrl } = (await import("@/lib/r2")) as unknown as {
      deleteTeamLogoByUrl: ReturnType<typeof vi.fn>;
    };
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.countTeamMembers.mockResolvedValueOnce(1);
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce("https://r2.example.com/logo.png");
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockDbWrite.batch.mockResolvedValue([{ results: [{ user_id: "u1" }], meta: { changes: 1, duration: 0 } }, { results: [], meta: { changes: 0, duration: 0 } }, { results: [], meta: { changes: 0, duration: 0 } }, { results: [{ logo_url: "https://r2.example.com/logo.png" }], meta: { changes: 1, duration: 0 } }]);
    deleteTeamLogoByUrl.mockResolvedValueOnce(undefined);

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(200);
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith("https://r2.example.com/logo.png");
  });

  it("should succeed even if logo deletion fails (best-effort)", async () => {
    const { deleteTeamLogoByUrl } = (await import("@/lib/r2")) as unknown as {
      deleteTeamLogoByUrl: ReturnType<typeof vi.fn>;
    };
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.countTeamMembers.mockResolvedValueOnce(1);
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce("https://r2.example.com/logo.png");
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockDbWrite.batch.mockResolvedValue([{ results: [{ user_id: "u1" }], meta: { changes: 1, duration: 0 } }, { results: [], meta: { changes: 0, duration: 0 } }, { results: [], meta: { changes: 0, duration: 0 } }, { results: [{ logo_url: "https://r2.example.com/logo.png" }], meta: { changes: 1, duration: 0 } }]);
    deleteTeamLogoByUrl.mockRejectedValueOnce(new Error("R2 unavailable"));

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(200);
  });

  it("should return 503 when teams table does not exist (DELETE)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockRejectedValueOnce(
      new Error("no such table: team_members"),
    );

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(503);
  });

  it("should return 500 on unexpected error in DELETE", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(500);
  });
  it.each([
    ["active", 0, 409], ["active", 1, 200], ["upcoming", 0, 200], ["ended", 1, 409],
    ["concurrent-member", 1, 409], ["late-failure", 1, 500],
  ] as const)("enforces %s withdrawal=%s atomically", async (status, withdrawal, expected) => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE teams (id TEXT PRIMARY KEY, logo_url TEXT);
      CREATE TABLE team_members (team_id TEXT REFERENCES teams(id), user_id TEXT, role TEXT);
      CREATE TABLE seasons (id TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, allow_late_withdrawal INTEGER, allow_roster_changes INTEGER);
      CREATE TABLE season_teams (team_id TEXT REFERENCES teams(id), season_id TEXT REFERENCES seasons(id));
      CREATE TABLE season_team_members (team_id TEXT REFERENCES teams(id), season_id TEXT REFERENCES seasons(id), user_id TEXT);
      INSERT INTO teams VALUES ('t1', NULL);
      INSERT INTO team_members VALUES ('t1', 'u1', 'owner');
    `);
    const start = status === "upcoming" ? "2999-01-01T00:00:00Z" : "2000-01-01T00:00:00Z";
    const end = status === "ended" ? "2001-01-01T00:00:00Z" : "2999-12-31T00:00:00Z";
    sqlite.prepare("INSERT INTO seasons VALUES ('s1', ?, ?, ?, 0)").run(start, end, withdrawal);
    sqlite.exec("INSERT INTO season_teams VALUES ('t1', 's1'); INSERT INTO season_team_members VALUES ('t1', 's1', 'u1');");
    if (status === "concurrent-member") sqlite.exec("INSERT INTO team_members VALUES ('t1', 'u2', 'member')");
    if (status === "late-failure") sqlite.exec("CREATE TABLE retained (team_id TEXT REFERENCES teams(id)); INSERT INTO retained VALUES ('t1')");
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.countTeamMembers.mockResolvedValueOnce(1);
    mockDbWrite.batch.mockImplementation(async (statements: Array<{ sql: string; params?: unknown[] }>) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(({ sql, params }) => ({
          results: sqlite.prepare(sql).all(...(params ?? []) as Array<string | number | null>),
          meta: { changes: 0, duration: 0 },
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    });
    try {
      const res = await DELETE(makeRequest("DELETE"), makeParams());
      expect(res.status).toBe(expected);
      for (const table of ["teams", "team_members", "season_teams", "season_team_members"]) {
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n).toBe(expected === 200 ? 0 : table === "team_members" && status === "concurrent-member" ? 2 : 1);
      }
    } finally { sqlite.close(); }
  });

});

// ---------------------------------------------------------------------------
// PATCH /api/teams/[teamId] — update team settings
// ---------------------------------------------------------------------------

describe("PATCH /api/teams/[teamId]", () => {
  let PATCH: (req: Request, ctx: { params: Promise<{ teamId: string }> }) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    const mod = await import("@/app/api/teams/[teamId]/route");
    PATCH = mod.PATCH;
  });

  it("should return 400 for invalid JSON", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    const req = new Request("http://localhost:7020/api/teams/t1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON");
  });

  it("should return 400 for name exceeding 64 characters", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    const res = await PATCH(
      makeRequest("PATCH", { name: "A".repeat(65) }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("max 64 characters");
  });

  it("should return 400 for empty name after trim", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    const res = await PATCH(
      makeRequest("PATCH", { name: "   " }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("max 64 characters");
  });

  it("should return 403 when user is not a member (PATCH)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce(null);

    const res = await PATCH(
      makeRequest("PATCH", { name: "Test" }),
      makeParams(),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should reject unauthenticated with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await PATCH(
      makeRequest("PATCH", { auto_register_season: true }),
      makeParams(),
    );

    expect(res.status).toBe(401);
  });

  it("should reject non-owner with 403", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u2" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member"); // not owner

    const res = await PATCH(
      makeRequest("PATCH", { auto_register_season: true }),
      makeParams(),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Only the team owner");
  });

  it("should toggle auto_register_season on", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await PATCH(
      makeRequest("PATCH", { auto_register_season: true }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.auto_register_season).toBe(true);
    // Should not include `name` when only auto_register_season was updated
    expect(body.name).toBeUndefined();
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("auto_register_season");
  });

  it("should toggle auto_register_season off", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await PATCH(
      makeRequest("PATCH", { auto_register_season: false }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.auto_register_season).toBe(false);
  });

  it("should rename team", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await PATCH(
      makeRequest("PATCH", { name: "New Name" }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("New Name");
    // Should not include `auto_register_season` when only name was updated
    expect(body.auto_register_season).toBeUndefined();
  });

  it("should update both name and auto_register_season together", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Updated", auto_register_season: true }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("Updated");
    expect(body.auto_register_season).toBe(true);
    // Single execute with both fields
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    const sql = mockDbWrite.execute.mock.calls[0]![0] as string;
    expect(sql).toContain("name = ?");
    expect(sql).toContain("auto_register_season = ?");
  });

  it("should return 400 when no valid fields provided", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });

    const res = await PATCH(
      makeRequest("PATCH", { foo: "bar" }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No valid fields");
  });

  it("should return 503 when auto_register_season column does not exist (migration lag)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    // UPDATE fails because column doesn't exist yet
    mockDbWrite.execute.mockRejectedValueOnce(
      new Error("no such column: auto_register_season"),
    );

    const res = await PATCH(
      makeRequest("PATCH", { auto_register_season: true }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toContain("migration pending");
  });

  it("should still allow name-only updates when auto_register_season column does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await PATCH(
      makeRequest("PATCH", { name: "New Name" }),
      makeParams(),
    );
    const body = await res.json();

    // Name-only update doesn't touch the new column, should succeed
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("New Name");
  });

  it("should return 500 when UPDATE fails with non-column error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    // UPDATE fails with unexpected error
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 connection timeout"));

    const res = await PATCH(
      makeRequest("PATCH", { name: "New Name" }),
      makeParams(),
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to rename");
  });

  it("should regenerate invite code", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await PATCH(
      makeRequest("PATCH", { regenerate_invite_code: true }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // New invite code should be a 32-char hex string
    expect(body.invite_code).toMatch(/^[0-9a-f]{32}$/);
    // Should not include unrelated fields
    expect(body.name).toBeUndefined();
    expect(body.auto_register_season).toBeUndefined();
    // SQL should update invite_code
    const sql = mockDbWrite.execute.mock.calls[0]![0] as string;
    expect(sql).toContain("invite_code = ?");
  });

  it("should regenerate invite code together with name update", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbWrite.execute.mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Renamed", regenerate_invite_code: true }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("Renamed");
    expect(body.invite_code).toMatch(/^[0-9a-f]{32}$/);
    // Single execute with both fields
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    const sql = mockDbWrite.execute.mock.calls[0]![0] as string;
    expect(sql).toContain("name = ?");
    expect(sql).toContain("invite_code = ?");
  });

  it("should reject non-owner from regenerating invite code", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u2" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member"); // not owner

    const res = await PATCH(
      makeRequest("PATCH", { regenerate_invite_code: true }),
      makeParams(),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Only the team owner");
  });
});

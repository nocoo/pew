import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

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

import * as dbModule from "@/lib/db";

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const { deleteTeamLogoByUrl } = (await import("@/lib/r2")) as unknown as {
  deleteTeamLogoByUrl: ReturnType<typeof vi.fn>;
};

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
    mockDbRead.firstOrNull.mockResolvedValueOnce(null); // no membership

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should return 404 when team not found", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "member" }) // membership exists
      .mockResolvedValueOnce(null); // team not found

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(404);
  });

  it("should return team details with members", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({
        id: "t1",
        name: "Team Alpha",
        slug: "team-alpha",
        invite_code: "abc12345",
        created_at: "2026-01-01T00:00:00Z",
      });
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          {
            user_id: "u1",
            name: "Alice",
            nickname: "ali",
            image: null,
            role: "owner",
            joined_at: "2026-01-01T00:00:00Z",
          },
          {
            user_id: "u2",
            name: "Bob",
            nickname: null,
            image: "https://example.com/bob.png",
            role: "member",
            joined_at: "2026-01-02T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({ results: [] }); // season registrations

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

  it("should fall back when nickname column does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "member" })
      .mockResolvedValueOnce({
        id: "t1",
        name: "Team",
        slug: "team",
        invite_code: "x",
        created_at: "2026-01-01T00:00:00Z",
      });
    // First query fails (no such column), fallback query succeeds
    mockDbRead.query
      .mockRejectedValueOnce(new Error("no such column: nickname"))
      .mockResolvedValueOnce({
        results: [
          {
            user_id: "u1",
            name: "Alice",
            image: null,
            role: "owner",
            joined_at: "2026-01-01T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({ results: [] }); // season registrations

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    // nickname should be null in fallback, so name field uses u.name
    expect(body.members[0].name).toBe("Alice");
  });

  it("should fall back when auto_register_season column does not exist (migration lag)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "member" })
      // First team query fails (no such column: auto_register_season)
      .mockRejectedValueOnce(new Error("no such column: auto_register_season"))
      // Fallback query without auto_register_season succeeds
      .mockResolvedValueOnce({
        id: "t1",
        name: "Team",
        slug: "team",
        invite_code: "x",
        created_at: "2026-01-01T00:00:00Z",
        logo_url: null,
      });
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          {
            user_id: "u1",
            name: "Alice",
            nickname: null,
            slug: null,
            image: null,
            role: "owner",
            joined_at: "2026-01-01T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({ results: [] }); // season registrations

    const res = await GET(makeRequest("GET"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    // auto_register_season should default to false when column doesn't exist
    expect(body.auto_register_season).toBe(false);
  });

  it("should return 404 when team not found during migration lag fallback", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "member" })
      // First team query fails (no such column)
      .mockRejectedValueOnce(new Error("no such column: auto_register_season"))
      // Fallback query returns null (team not found)
      .mockResolvedValueOnce(null);

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(404);
  });

  it("should rethrow non-column errors from team query", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "member" })
      // Team query fails with unexpected error
      .mockRejectedValueOnce(new Error("D1 connection failed"));

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(500);
  });

  it("should return 503 when teams table does not exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull.mockRejectedValueOnce(
      new Error("no such table: team_members"),
    );

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(503);
  });

  it("should return 500 on unexpected error in GET", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("D1 boom"));

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
    mockDbRead.firstOrNull.mockResolvedValueOnce(null); // no membership

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(403);
  });

  it("should prevent owner from leaving when other members exist", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "owner" }) // membership
      .mockResolvedValueOnce({ cnt: 3 }); // 3 members

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Transfer ownership");
  });

  it("should allow non-owner to leave (team persists)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u2" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "member" }) // not owner
      .mockResolvedValueOnce({ cnt: 3 }); // 3 members
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });

    const res = await DELETE(makeRequest("DELETE"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Should only delete membership, NOT the team
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("DELETE FROM team_members");
  });

  it("should delete team when last member leaves", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({ cnt: 1 }) // last member
      .mockResolvedValueOnce({ logo_url: null }); // team logo check
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockDbWrite.batch.mockResolvedValue([]);

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(200);
    // Should delete membership first
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("DELETE FROM team_members");
    // Then batch delete season_teams + team (preserving season_roster_snapshots for history)
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
    const batchCalls = mockDbWrite.batch.mock.calls[0]![0] as Array<{ sql: string }>;
    expect(batchCalls.some((s) => s.sql.includes("DELETE FROM season_teams"))).toBe(true);
    expect(batchCalls.some((s) => s.sql.includes("DELETE FROM teams"))).toBe(true);
    // Should NOT delete season_roster_snapshots (historical data)
    expect(batchCalls.some((s) => s.sql.includes("DELETE FROM season_roster_snapshots"))).toBe(false);
  });

  it("should delete logo from R2 when last member leaves and team has logo", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({ cnt: 1 }) // last member
      .mockResolvedValueOnce({ logo_url: "https://r2.example.com/logo.png" }); // team HAS logo
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockDbWrite.batch.mockResolvedValue([]);
    deleteTeamLogoByUrl.mockResolvedValueOnce(undefined);

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(200);
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith("https://r2.example.com/logo.png");
  });

  it("should succeed even if logo deletion fails", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "owner" })
      .mockResolvedValueOnce({ cnt: 1 }) // last member
      .mockResolvedValueOnce({ logo_url: "https://r2.example.com/logo.png" }); // team HAS logo
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockDbWrite.batch.mockResolvedValue([]);
    deleteTeamLogoByUrl.mockRejectedValueOnce(new Error("R2 unavailable"));

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    // Should still succeed — logo cleanup is best-effort
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("should return 503 when teams table does not exist (DELETE)", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull.mockRejectedValueOnce(
      new Error("no such table: team_members"),
    );

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(503);
  });

  it("should return 500 on unexpected error in DELETE", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("D1 boom"));

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(500);
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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "member" }); // not owner

    const res = await PATCH(
      makeRequest("PATCH", { auto_register_season: true }),
      makeParams(),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Only the team owner");
  });

  it("should reject non-member with 403", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u2" });
    mockDbRead.firstOrNull.mockResolvedValueOnce(null); // not a member at all

    const res = await PATCH(
      makeRequest("PATCH", { name: "New Name" }),
      makeParams(),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should toggle auto_register_season on", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "owner" });
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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "owner" });
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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "owner" });
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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "owner" });
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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "owner" });
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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "owner" });
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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    // UPDATE fails with unexpected error
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 connection timeout"));

    const res = await PATCH(
      makeRequest("PATCH", { name: "New Name" }),
      makeParams(),
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to rename");
  });

  it("should return 500 when PATCH error is not Error instance", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "owner-1" });
    mockDbRead.firstOrNull
      .mockResolvedValueOnce({ role: "owner" }); // membership check
    mockDbWrite.execute.mockRejectedValueOnce("string error");

    const res = await PATCH(
      makeRequest("PATCH", { name: "New Name" }),
      { params: Promise.resolve({ teamId: "team-1" }) },
    );

    expect(res.status).toBe(500);
  });
});

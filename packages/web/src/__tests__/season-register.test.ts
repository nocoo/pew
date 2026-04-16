import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("@/lib/seasons", () => ({
  deriveSeasonStatus: vi.fn(),
}));

import { POST, DELETE } from "@/app/api/seasons/[seasonId]/register/route";
import { createMockDbRead, createMockDbWrite, makeJsonRequest } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const { deriveSeasonStatus } = (await import("@/lib/seasons")) as unknown as {
  deriveSeasonStatus: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER = { userId: "u1", email: "test@example.com" };
const PARAMS = { params: Promise.resolve({ seasonId: "season-1" }) };

function postReq(body?: unknown) {
  return makeJsonRequest("POST", "/api/seasons/season-1/register", body);
}

function deleteReq(body?: unknown) {
  return makeJsonRequest("DELETE", "/api/seasons/season-1/register", body);
}

const SEASON_UPCOMING = {
  id: "season-1",
  start_date: "2099-01-01",
  end_date: "2099-12-31",
  allow_late_registration: 0,
  allow_late_withdrawal: 0,
};

const MEMBERS = [
  { user_id: "u1" },
  { user_id: "u2" },
];

// ---------------------------------------------------------------------------
// POST /api/seasons/[seasonId]/register
// ---------------------------------------------------------------------------

describe("POST /api/seasons/[seasonId]/register", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("returns 401 when unauthenticated", async () => {
    resolveUser.mockResolvedValueOnce(null);
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    const req = new Request("http://localhost:7020/api/seasons/season-1/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON");
  });

  it("returns 400 when team_id is missing", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    const res = await POST(postReq({}), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("team_id");
  });

  it("returns 400 when team_id is not a string", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    const res = await POST(postReq({ team_id: 123 }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("team_id");
  });

  it("returns 404 when season not found", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(null);
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 400 when season is ended", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("ended");
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ended");
  });

  it("returns 400 when season is active and late registration disabled", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ ...SEASON_UPCOMING, allow_late_registration: 0 });
    deriveSeasonStatus.mockReturnValueOnce("active");
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Registration closed");
  });

  it("allows registration when season is active and late registration enabled", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ ...SEASON_UPCOMING, allow_late_registration: 1 });
    deriveSeasonStatus.mockReturnValueOnce("active");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce([]);
    mockDbWrite.batch.mockResolvedValueOnce(undefined);

    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(201);
  });

  it("returns 403 when user is not team owner", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 403 when user has no membership", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce(null);
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 409 when team already registered", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce({ id: "existing" });
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already registered");
  });

  it("returns 409 when a member has conflict on another team", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce(MEMBERS);
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce({ user_id: "u2" });
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already registered");
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("skips conflict check when team has no members", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce([]);
    mockDbWrite.batch.mockResolvedValueOnce(undefined);

    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(201);
    expect(mockDbRead.checkSeasonMemberConflict).not.toHaveBeenCalled();
  });

  it("returns 201 with registration data on success", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce(MEMBERS);
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbWrite.batch.mockResolvedValueOnce(undefined);

    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeDefined();
    expect(json.season_id).toBe("season-1");
    expect(json.team_id).toBe("t1");
    expect(json.registered_at).toBeDefined();

    // Batch: 1 season_teams + 2 season_team_members
    const stmts = mockDbWrite.batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    expect(stmts).toHaveLength(3);
    expect(stmts[0]!.sql).toContain("season_teams");
    expect(stmts[1]!.sql).toContain("season_team_members");
    expect(stmts[2]!.sql).toContain("season_team_members");
  });

  it("compensates by UUID on batch failure", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce(MEMBERS);
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbWrite.batch.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
    mockDbWrite.execute.mockResolvedValue({ changes: 0, duration: 0.01 });

    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(500);

    // 2 compensation calls: member deletes + team delete
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(2);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("DELETE FROM season_team_members WHERE id IN");
    expect(mockDbWrite.execute.mock.calls[1]![0]).toContain("DELETE FROM season_teams WHERE id = ?");
  });

  it("swallows cleanup errors during compensation", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce(MEMBERS);
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbWrite.batch.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
    // Cleanup itself fails
    mockDbWrite.execute.mockRejectedValue(new Error("cleanup failed"));

    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    // Should still return 500 from the original error, not crash
    expect(res.status).toBe(500);
  });

  it("returns 503 on 'no such table' error", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockRejectedValueOnce(new Error("no such table: season_teams"));
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("not yet migrated");
  });

  it("returns 500 on generic error", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockRejectedValueOnce(new Error("something broke"));
    const res = await POST(postReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/seasons/[seasonId]/register
// ---------------------------------------------------------------------------

describe("DELETE /api/seasons/[seasonId]/register", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  it("returns 401 when unauthenticated", async () => {
    resolveUser.mockResolvedValueOnce(null);
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    const req = new Request("http://localhost:7020/api/seasons/season-1/register", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await DELETE(req, PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON");
  });

  it("returns 400 when team_id is missing", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    const res = await DELETE(deleteReq({}), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("team_id");
  });

  it("returns 400 when team_id is not a string", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    const res = await DELETE(deleteReq({ team_id: 42 }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("returns 404 when season not found", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(null);
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("Season not found");
  });

  it("returns 400 when season is ended", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("ended");
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ended");
  });

  it("returns 400 when season is active and late withdrawal disabled", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ ...SEASON_UPCOMING, allow_late_withdrawal: 0 });
    deriveSeasonStatus.mockReturnValueOnce("active");
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Withdrawal closed");
  });

  it("allows withdrawal when season is active and late withdrawal enabled", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ ...SEASON_UPCOMING, allow_late_withdrawal: 1 });
    deriveSeasonStatus.mockReturnValueOnce("active");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce({ id: "reg-1" });
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });

  it("returns 403 when user is not team owner", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 403 when user has no membership", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce(null);
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when registration not found", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("not registered");
  });

  it("returns 200 on successful withdrawal", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(SEASON_UPCOMING);
    deriveSeasonStatus.mockReturnValueOnce("upcoming");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce({ id: "reg-1" });
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    // Verify both deletes
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(2);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("season_team_members");
    expect(mockDbWrite.execute.mock.calls[1]![0]).toContain("season_teams");
  });

  it("returns 503 on 'no such table' error", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockRejectedValueOnce(new Error("no such table: season_teams"));
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("not yet migrated");
  });

  it("returns 500 on generic error", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockRejectedValueOnce(new Error("unexpected"));
    const res = await DELETE(deleteReq({ team_id: "t1" }), PARAMS);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to withdraw");
  });
});

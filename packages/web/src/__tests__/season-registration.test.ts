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

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { POST, DELETE } from "@/app/api/seasons/[seasonId]/register/route";
import { createMockDbRead, createMockDbWrite, makeJsonRequest } from "./test-utils";
import * as dbModule from "@/lib/db";

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER = { userId: "user-1", email: "user@test.com" };
const regParams = Promise.resolve({ seasonId: "season-1" });

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

  it("should register team when user is owner and season is upcoming", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    // Season upcoming
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    // User is team owner
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    // No existing registration
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    // Fetch current team members
    mockDbRead.getTeamMembers.mockResolvedValueOnce([
      { user_id: "user-1", name: null, nickname: null, slug: null, image: null, role: "member", joined_at: "" },
      { user_id: "user-2", name: null, nickname: null, slug: null, image: null, role: "member", joined_at: "" },
    ]);
    // Pre-validation: no member conflict
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    // Batch write succeeds
    mockDbWrite.batch.mockResolvedValueOnce(undefined);

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.season_id).toBe("season-1");
    expect(json.team_id).toBe("team-1");

    // Verify frozen roster: fetch members then batch write
    expect(mockDbRead.getTeamMembers).toHaveBeenCalledWith("team-1");
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
    const batchStatements = mockDbWrite.batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    // 1 season_teams INSERT + 2 season_team_members INSERTs
    expect(batchStatements).toHaveLength(3);
    expect(batchStatements[0]!.sql).toContain("season_teams");
    expect(batchStatements[1]!.sql).toContain("season_team_members");
    expect(batchStatements[2]!.sql).toContain("season_team_members");
  });

  it("should reject when a member is already registered on another team", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce([
      { user_id: "user-1", name: null, nickname: null, slug: null, image: null, role: "member", joined_at: "" },
      { user_id: "user-2", name: null, nickname: null, slug: null, image: null, role: "member", joined_at: "" },
    ]);
    // Pre-validation: user-2 is already on another team
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce({ user_id: "user-2" });

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already registered");
    // No batch write should have happened
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should reject when season is active", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01T00:00:00Z",
      end_date: "2099-12-31T23:59:00Z",
      allow_late_registration: 0,
    });

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Registration closed");
  });

  it("should reject when season is ended", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01T00:00:00Z",
      end_date: "2020-12-31T23:59:00Z",
      allow_late_registration: 0,
    });

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ended");
  });

  it("should allow registration for active season when allow_late_registration=1", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01",
      end_date: "2099-12-31",
      allow_late_registration: 1,
    });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce([
      { user_id: "user-1", name: null, nickname: null, slug: null, image: null, role: "member", joined_at: "" },
    ]);
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbWrite.batch.mockResolvedValueOnce(undefined);

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(201);
  });

  it("should reject registration for ended season even when allow_late_registration=1", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01T00:00:00Z",
      end_date: "2020-12-31T23:59:00Z",
      allow_late_registration: 1,
    });

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ended");
  });

  it("should reject when user is not team owner", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("owners");
  });

  it("should reject when team is already registered", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce({ id: "existing-reg" });

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already registered");
  });

  it("should reject when season does not exist", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce(null);

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(404);
  });

  it("should reject unauthenticated requests", async () => {
    resolveUser.mockResolvedValueOnce(null);

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(401);
  });

  it("should compensate by UUID on batch failure, not by (season_id, team_id)", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);
    mockDbRead.getTeamMembers.mockResolvedValueOnce([
      { user_id: "user-1", name: null, nickname: null, slug: null, image: null, role: "member", joined_at: "" },
      { user_id: "user-2", name: null, nickname: null, slug: null, image: null, role: "member", joined_at: "" },
    ]);
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    // Batch fails (e.g. UNIQUE constraint from concurrent request)
    mockDbWrite.batch.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
    // Cleanup calls succeed
    mockDbWrite.execute.mockResolvedValue({ changes: 0, duration: 0.01 });

    const res = await POST(makeJsonRequest("POST", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(500);

    // Compensation should use UUID-based deletes, not (season_id, team_id)
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(2);

    // First call: DELETE season_team_members WHERE id IN (?, ?)
    const memberDeleteCall = mockDbWrite.execute.mock.calls[0]!;
    expect(memberDeleteCall[0]).toContain("DELETE FROM season_team_members WHERE id IN");
    expect(memberDeleteCall[0]).not.toContain("season_id");
    // Should pass 2 UUIDs (one per member)
    expect(memberDeleteCall[1]).toHaveLength(2);

    // Second call: DELETE season_teams WHERE id = ?
    const teamDeleteCall = mockDbWrite.execute.mock.calls[1]!;
    expect(teamDeleteCall[0]).toContain("DELETE FROM season_teams WHERE id = ?");
    expect(teamDeleteCall[0]).not.toContain("season_id");
    // Should pass 1 UUID
    expect(teamDeleteCall[1]).toHaveLength(1);
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

  it("should withdraw team from upcoming season", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce({ id: "reg-1" });
    // DELETE season_team_members + DELETE season_teams
    mockDbWrite.execute
      .mockResolvedValueOnce({ changes: 2, duration: 0.01 })
      .mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await DELETE(makeJsonRequest("DELETE", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);

    // Verify both deletes happened
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(2);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("season_team_members");
    expect(mockDbWrite.execute.mock.calls[1]![0]).toContain("season_teams");
  });

  it("should reject withdrawal from active season", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01T00:00:00Z",
      end_date: "2099-12-31T23:59:00Z",
      allow_late_withdrawal: 0,
    });

    const res = await DELETE(makeJsonRequest("DELETE", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Withdrawal closed");
  });

  it("should allow withdrawal from active season when allow_late_withdrawal=1", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01",
      end_date: "2099-12-31",
      allow_late_withdrawal: 1,
    });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce({ id: "reg-1" });
    mockDbWrite.execute
      .mockResolvedValueOnce({ changes: 1, duration: 0.01 })
      .mockResolvedValueOnce({ changes: 1, duration: 0.01 });

    const res = await DELETE(makeJsonRequest("DELETE", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
  });

  it("should reject withdrawal from ended season even when allow_late_withdrawal=1", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({
      id: "season-1",
      start_date: "2020-01-01T00:00:00Z",
      end_date: "2020-12-31T23:59:00Z",
      allow_late_withdrawal: 1,
    });

    const res = await DELETE(makeJsonRequest("DELETE", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ended");
  });

  it("should reject when user is not team owner", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");

    const res = await DELETE(makeJsonRequest("DELETE", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(403);
  });

  it("should reject when registration does not exist", async () => {
    resolveUser.mockResolvedValueOnce(USER);
    mockDbRead.getSeasonById.mockResolvedValueOnce({ id: "season-1", start_date: "2099-01-01T00:00:00Z", end_date: "2099-12-31T23:59:00Z" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getSeasonRegistration.mockResolvedValueOnce(null);

    const res = await DELETE(makeJsonRequest("DELETE", "/api/seasons/season-1/register", { team_id: "team-1" }), {
      params: regParams,
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("not registered");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

// ---------------------------------------------------------------------------
// Tests for autoRegisterTeamsForSeason
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

import { autoRegisterTeamsForSeason } from "@/lib/auto-register";

// Helper to create a valid upcoming season
function mockUpcomingSeason() {
  const now = new Date();
  const start = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
  return {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    allow_late_registration: 0,
  };
}

// Helper to create an ended season
function mockEndedSeason() {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // -30 days
  const end = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // -7 days
  return {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    allow_late_registration: 0,
  };
}

// Helper to create an active season
function mockActiveSeason(allowLateRegistration: boolean) {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // -7 days
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
  return {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    allow_late_registration: allowLateRegistration ? 1 : 0,
  };
}

describe("autoRegisterTeamsForSeason", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
  });

  // -------------------------------------------------------------------------
  // Season eligibility checks
  // -------------------------------------------------------------------------

  it("should return seasonEligible=false for ended seasons", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockEndedSeason());

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(false);
    expect(result.registered).toBe(0);
    expect(mockDbRead.listAutoRegisterTeams).not.toHaveBeenCalled(); // should not query teams
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should return seasonEligible=false for active seasons without late registration", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockActiveSeason(false));

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(false);
    expect(result.registered).toBe(0);
    expect(mockDbRead.listAutoRegisterTeams).not.toHaveBeenCalled();
  });

  it("does not auto-register an active season even when late registration is allowed", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockActiveSeason(true));

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(false);
    expect(result.registered).toBe(0);
    expect(mockDbRead.listAutoRegisterTeams).not.toHaveBeenCalled();
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should return seasonEligible=false when season not found", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(null);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(false);
    expect(result.registered).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Team registration
  // -------------------------------------------------------------------------

  it("should return registered=0 when no teams have auto-registration enabled", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([]); // no eligible teams

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.seasonEligible).toBe(true);
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should auto-register a team with no member conflicts", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-1"); // owner lookup
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([{ id: "team-1", created_by: "owner-1" }]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u1", "u2"]);
    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
    // Should have 1 season_teams INSERT + 2 season_team_members INSERTs
    const batchStatements = mockDbWrite.batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    expect(batchStatements).toHaveLength(3);
    expect(batchStatements[0]!.sql).toContain("INSERT INTO season_teams");
    expect(batchStatements[1]!.sql).toContain("INSERT INTO season_team_members");
    expect(batchStatements[2]!.sql).toContain("INSERT INTO season_team_members");
  });

  it("should skip team when a member has a conflict", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce({ user_id: "u1" }); // conflict found
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([{ id: "team-1", created_by: "owner-1" }]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u1"]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should register multiple teams and skip conflicting ones", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce({ user_id: "u1" });
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-2");
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([
      { id: "team-1", created_by: "owner-1" },
      { id: "team-2", created_by: "owner-2" },
    ]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u2"]);

    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
  });

  it("should handle team with no members gracefully", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-1"); // owner lookup
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([{ id: "team-empty", created_by: "owner-1" }]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce([]); // no members

    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    // Only 1 statement: season_teams INSERT (no member rows)
    const batchStatements = mockDbWrite.batch.mock.calls[0]![0] as Array<{ sql: string; params: unknown[] }>;
    expect(batchStatements).toHaveLength(1);
    expect(batchStatements[0]!.sql).toContain("INSERT INTO season_teams");
  });

  it("should continue processing after read error and preserve partial success", async () => {
    // Team-1: member query fails
    // Team-2: succeeds
    // Result should show registered=1, skipped=1 (not throw)
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-2");
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([
      { id: "team-1", created_by: "owner-1" },
      { id: "team-2", created_by: "owner-2" },
    ]);
    mockDbRead.getTeamMemberUserIds.mockRejectedValueOnce(new Error("D1 read timeout"));
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u2"]);

    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
  });

  it("should skip team on conflict check read error but continue", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockRejectedValueOnce(new Error("D1 read error"));
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-2");
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([
      { id: "team-1", created_by: "owner-1" },
      { id: "team-2", created_by: "owner-2" },
    ]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u2"]);

    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("should compensate on batch failure and count as skipped", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-1"); // owner
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([{ id: "team-1", created_by: "owner-1" }]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u1"]);

    mockDbWrite.batch.mockRejectedValueOnce(new Error("D1 batch failed"));
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    // Compensation must use THIS request's generated UUIDs only
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(2);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("DELETE FROM season_team_members WHERE id IN");
    expect(mockDbWrite.execute.mock.calls[1]![0]).toContain("DELETE FROM season_teams WHERE id = ?");
  });

  it("falls back to team.created_by when owner lookup returns null", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbRead.getTeamOwner.mockResolvedValueOnce(null); // owner lookup empty → fallback path
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([{ id: "team-1", created_by: "fallback-creator" }]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u1"]);
    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");
    expect(result.registered).toBe(1);
    const batchStatements = mockDbWrite.batch.mock.calls[0]![0] as Array<{
      sql: string;
      params: unknown[];
    }>;
    // season_teams INSERT's 4th param is registered_by; should be team.created_by.
    expect(batchStatements[0]!.params[3]).toBe("fallback-creator");
  });

  it("skips season_team_members DELETE when team has zero members and batch fails", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-1");
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([{ id: "team-empty", created_by: "owner-1" }]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce([]);
    mockDbWrite.batch.mockRejectedValueOnce(new Error("D1 batch failed"));
    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");
    expect(result.skipped).toBe(1);
    expect(result.registered).toBe(0);
    // Only the season_teams DELETE should fire — no member DELETE since memberIds is empty.
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    expect(mockDbWrite.execute.mock.calls[0]![0]).toContain("DELETE FROM season_teams WHERE id = ?");
  });

  it("swallows cleanup errors after a batch failure", async () => {
    mockDbRead.getSeasonById.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.checkSeasonMemberConflict.mockResolvedValueOnce(null);
    mockDbRead.getTeamOwner.mockResolvedValueOnce("owner-1");
    mockDbRead.listAutoRegisterTeams.mockResolvedValueOnce([{ id: "team-1", created_by: "owner-1" }]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["u1"]);
    mockDbWrite.batch.mockRejectedValueOnce(new Error("D1 batch failed"));
    // First execute (member DELETE) throws; outer try/catch swallows it.
    mockDbWrite.execute.mockRejectedValueOnce(new Error("cleanup failed"));

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");
    expect(result.skipped).toBe(1);
    expect(result.registered).toBe(0);
  });
});

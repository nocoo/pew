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
    mockDbRead.firstOrNull.mockResolvedValueOnce(mockEndedSeason());

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(false);
    expect(result.registered).toBe(0);
    expect(mockDbRead.query).not.toHaveBeenCalled(); // should not query teams
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should return seasonEligible=false for active seasons without late registration", async () => {
    mockDbRead.firstOrNull.mockResolvedValueOnce(mockActiveSeason(false));

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(false);
    expect(result.registered).toBe(0);
    expect(mockDbRead.query).not.toHaveBeenCalled();
  });

  it("should allow registration for active seasons with late registration enabled", async () => {
    mockDbRead.firstOrNull.mockResolvedValueOnce(mockActiveSeason(true));
    mockDbRead.query.mockResolvedValueOnce({ results: [] }); // no teams

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(true);
    expect(result.registered).toBe(0);
  });

  it("should return seasonEligible=false when season not found", async () => {
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.seasonEligible).toBe(false);
    expect(result.registered).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Team registration
  // -------------------------------------------------------------------------

  it("should return registered=0 when no teams have auto-registration enabled", async () => {
    mockDbRead.firstOrNull.mockResolvedValueOnce(mockUpcomingSeason());
    mockDbRead.query.mockResolvedValueOnce({ results: [] }); // no eligible teams

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.seasonEligible).toBe(true);
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should auto-register a team with no member conflicts", async () => {
    mockDbRead.firstOrNull
      .mockResolvedValueOnce(mockUpcomingSeason())
      .mockResolvedValueOnce(null) // no conflict
      .mockResolvedValueOnce({ user_id: "owner-1" }); // owner lookup
    mockDbRead.query
      .mockResolvedValueOnce({
        // eligible teams
        results: [{ id: "team-1", created_by: "owner-1" }],
      })
      .mockResolvedValueOnce({
        // team members
        results: [{ user_id: "u1" }, { user_id: "u2" }],
      });
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
    mockDbRead.firstOrNull
      .mockResolvedValueOnce(mockUpcomingSeason())
      .mockResolvedValueOnce({ user_id: "u1" }); // conflict found
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [{ id: "team-1", created_by: "owner-1" }],
      })
      .mockResolvedValueOnce({
        results: [{ user_id: "u1" }],
      });

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockDbWrite.batch).not.toHaveBeenCalled();
  });

  it("should register multiple teams and skip conflicting ones", async () => {
    mockDbRead.firstOrNull
      .mockResolvedValueOnce(mockUpcomingSeason())
      // team-1: conflict found — skip
      .mockResolvedValueOnce({ user_id: "u1" })
      // team-2: no conflict
      .mockResolvedValueOnce(null)
      // team-2 owner lookup
      .mockResolvedValueOnce({ user_id: "owner-2" });
    mockDbRead.query
      .mockResolvedValueOnce({
        // 2 eligible teams
        results: [
          { id: "team-1", created_by: "owner-1" },
          { id: "team-2", created_by: "owner-2" },
        ],
      })
      // team-1 members
      .mockResolvedValueOnce({ results: [{ user_id: "u1" }] })
      // team-2 members
      .mockResolvedValueOnce({ results: [{ user_id: "u2" }] });

    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
  });

  it("should handle team with no members gracefully", async () => {
    mockDbRead.firstOrNull
      .mockResolvedValueOnce(mockUpcomingSeason())
      .mockResolvedValueOnce({ user_id: "owner-1" }); // owner lookup
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [{ id: "team-empty", created_by: "owner-1" }],
      })
      .mockResolvedValueOnce({ results: [] }); // no members

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
    mockDbRead.firstOrNull
      .mockResolvedValueOnce(mockUpcomingSeason())
      // team-2: no conflict
      .mockResolvedValueOnce(null)
      // team-2 owner lookup
      .mockResolvedValueOnce({ user_id: "owner-2" });
    mockDbRead.query
      .mockResolvedValueOnce({
        // 2 eligible teams
        results: [
          { id: "team-1", created_by: "owner-1" },
          { id: "team-2", created_by: "owner-2" },
        ],
      })
      // team-1 member query fails
      .mockRejectedValueOnce(new Error("D1 read timeout"))
      // team-2 members
      .mockResolvedValueOnce({ results: [{ user_id: "u2" }] });

    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockDbWrite.batch).toHaveBeenCalledTimes(1);
  });

  it("should skip team on conflict check read error but continue", async () => {
    mockDbRead.firstOrNull
      .mockResolvedValueOnce(mockUpcomingSeason())
      // team-1: conflict check fails
      .mockRejectedValueOnce(new Error("D1 read error"))
      // team-2: no conflict
      .mockResolvedValueOnce(null)
      // team-2 owner lookup
      .mockResolvedValueOnce({ user_id: "owner-2" });
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [
          { id: "team-1", created_by: "owner-1" },
          { id: "team-2", created_by: "owner-2" },
        ],
      })
      // team-1 members (query succeeds, then conflict check fails)
      .mockResolvedValueOnce({ results: [{ user_id: "u1" }] })
      // team-2 members
      .mockResolvedValueOnce({ results: [{ user_id: "u2" }] });

    mockDbWrite.batch.mockResolvedValueOnce([]);

    const result = await autoRegisterTeamsForSeason(mockDbRead, mockDbWrite, "season-1");

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("should compensate on batch failure and count as skipped", async () => {
    mockDbRead.firstOrNull
      .mockResolvedValueOnce(mockUpcomingSeason())
      .mockResolvedValueOnce(null) // no conflict
      .mockResolvedValueOnce({ user_id: "owner-1" }); // owner
    mockDbRead.query
      .mockResolvedValueOnce({
        results: [{ id: "team-1", created_by: "owner-1" }],
      })
      .mockResolvedValueOnce({ results: [{ user_id: "u1" }] });

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
});

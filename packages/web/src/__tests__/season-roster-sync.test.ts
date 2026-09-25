import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

import { syncSeasonRosters, syncAllRostersForSeason } from "@/lib/season-roster";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncSeasonRosters", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
  });

  it("should no-op when team has no registered active seasons", async () => {
    mockDbRead.listRosterSyncSeasons.mockResolvedValueOnce([]);

    await syncSeasonRosters(mockDbRead as never, mockDbWrite as never, "team-1");

    // Only the initial query, no further calls
    expect(mockDbRead.listRosterSyncSeasons).toHaveBeenCalledWith("team-1");
    expect(mockDbWrite.execute).not.toHaveBeenCalled();
  });

  it("should no-op when allow_roster_changes=0 (filtered out by query)", async () => {
    // The query filters for allow_roster_changes = 1, so if the season
    // has it disabled, it won't appear in results
    mockDbRead.listRosterSyncSeasons.mockResolvedValueOnce([]);

    await syncSeasonRosters(mockDbRead as never, mockDbWrite as never, "team-1");

    expect(mockDbRead.listRosterSyncSeasons).toHaveBeenCalledWith("team-1");
    expect(mockDbWrite.execute).not.toHaveBeenCalled();
  });

  it("should add new members when active season allows roster changes", async () => {
    // Active season with roster changes enabled
    mockDbRead.listRosterSyncSeasons.mockResolvedValueOnce(["season-1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1", "user-2", "user-3"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce(["user-1"]);

    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    await syncSeasonRosters(mockDbRead as never, mockDbWrite as never, "team-1");

    // Should have 3 queries: active seasons, team members, season members
    expect(mockDbRead.getRosterUserIds).toHaveBeenCalledWith("season-1", "team-1");

    // Should INSERT user-2 and user-3 (not user-1 since already in roster)
    const insertCalls = mockDbWrite.execute.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes("INSERT OR IGNORE"),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]![1]).toContain("user-2");
    expect(insertCalls[1]![1]).toContain("user-3");
  });

  it("should remove departed members when active season allows roster changes", async () => {
    mockDbRead.listRosterSyncSeasons.mockResolvedValueOnce(["season-1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce(["user-1", "user-2"]);

    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    await syncSeasonRosters(mockDbRead as never, mockDbWrite as never, "team-1");

    // Should DELETE user-2 (departed from team)
    const deleteCalls = mockDbWrite.execute.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes("DELETE"),
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![1]).toContain("user-2");
  });

  it("should handle INSERT OR IGNORE silently for UNIQUE conflicts", async () => {
    mockDbRead.listRosterSyncSeasons.mockResolvedValueOnce(["season-1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1", "user-2"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce([]);

    // INSERT OR IGNORE returns changes=0 when UNIQUE constraint fires
    mockDbWrite.execute.mockResolvedValue({ changes: 0, duration: 0.01 });

    // Should not throw
    await syncSeasonRosters(mockDbRead as never, mockDbWrite as never, "team-1");

    const insertCalls = mockDbWrite.execute.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes("INSERT OR IGNORE"),
    );
    expect(insertCalls).toHaveLength(2);
  });

  it("should process multiple active seasons", async () => {
    mockDbRead.listRosterSyncSeasons.mockResolvedValueOnce(["season-1", "season-2"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce([]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce([]);

    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    await syncSeasonRosters(mockDbRead as never, mockDbWrite as never, "team-1");

    // 1 (active seasons) + 1 (team members) + 2 (season rosters)
    expect(mockDbRead.getRosterUserIds).toHaveBeenCalledTimes(2);

    // 2 INSERTs (user-1 into each season)
    const insertCalls = mockDbWrite.execute.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes("INSERT OR IGNORE"),
    );
    expect(insertCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// syncAllRostersForSeason
// ---------------------------------------------------------------------------

describe("syncAllRostersForSeason", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
  });

  it("should return 0 when no teams are registered", async () => {
    mockDbRead.getRegisteredTeamIds.mockResolvedValueOnce([]);

    const count = await syncAllRostersForSeason(mockDbRead as never, mockDbWrite as never, "season-1");

    expect(count).toBe(0);
    expect(mockDbRead.getRegisteredTeamIds).toHaveBeenCalledWith("season-1");
    expect(mockDbWrite.execute).not.toHaveBeenCalled();
  });

  it("should add missing members for a single team", async () => {
    mockDbRead.getRegisteredTeamIds.mockResolvedValueOnce(["team-1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1", "user-2"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce(["user-1"]);

    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const count = await syncAllRostersForSeason(mockDbRead as never, mockDbWrite as never, "season-1");

    expect(count).toBe(1);

    // Should INSERT user-2 only
    const insertCalls = mockDbWrite.execute.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes("INSERT OR IGNORE"),
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]![1]).toContain("user-2");
  });

  it("should remove departed members", async () => {
    mockDbRead.getRegisteredTeamIds.mockResolvedValueOnce(["team-1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce(["user-1", "user-2"]);

    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const count = await syncAllRostersForSeason(mockDbRead as never, mockDbWrite as never, "season-1");

    expect(count).toBe(1);

    const deleteCalls = mockDbWrite.execute.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes("DELETE"),
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![1]).toContain("user-2");
  });

  it("should handle multiple teams", async () => {
    mockDbRead.getRegisteredTeamIds.mockResolvedValueOnce(["team-1", "team-2"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce([]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-3", "user-4"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce(["user-3"]);

    mockDbWrite.execute.mockResolvedValue({ changes: 1, duration: 0.01 });

    const count = await syncAllRostersForSeason(mockDbRead as never, mockDbWrite as never, "season-1");

    expect(count).toBe(2);

    // 1 (season_teams) + 2 (team members) + 2 (season rosters) = 5
    expect(mockDbRead.getRosterUserIds).toHaveBeenCalledTimes(2);

    // 2 INSERTs: user-1 into team-1, user-4 into team-2
    const insertCalls = mockDbWrite.execute.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes("INSERT OR IGNORE"),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]![1]).toContain("user-1");
    expect(insertCalls[1]![1]).toContain("user-4");
  });

  it("should no-op when rosters are already in sync", async () => {
    mockDbRead.getRegisteredTeamIds.mockResolvedValueOnce(["team-1"]);
    mockDbRead.getTeamMemberUserIds.mockResolvedValueOnce(["user-1"]);
    mockDbRead.getRosterUserIds.mockResolvedValueOnce(["user-1"]);

    const count = await syncAllRostersForSeason(mockDbRead as never, mockDbWrite as never, "season-1");

    expect(count).toBe(1);
    expect(mockDbWrite.execute).not.toHaveBeenCalled();
  });
});

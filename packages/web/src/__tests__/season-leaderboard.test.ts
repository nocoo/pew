import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { GET } from "@/app/api/seasons/[seasonId]/leaderboard/route";
import * as dbModule from "@/lib/db";
import { createMockDbRead } from "./test-utils";

function makeRequest(
  url = "http://localhost:7020/api/seasons/season-1/leaderboard"
): Request {
  return new Request(url, { method: "GET" });
}

const routeParams = Promise.resolve({ seasonId: "season-1" });

// Active season: start in the past, end in the future (no snapshot)
const ACTIVE_SEASON = {
  id: "season-1",
  name: "Season 1",
  slug: "s1",
  start_date: "2026-03-01T00:00:00Z",
  end_date: "2026-03-31T23:59:00Z",
  snapshot_ready: 0,
};

// Ended season with snapshot ready
const ENDED_SEASON = {
  id: "season-2",
  name: "Season 2",
  slug: "s2",
  start_date: "2026-01-01T00:00:00Z",
  end_date: "2026-01-31T23:59:00Z",
  snapshot_ready: 1,
};

// Ended season without snapshot
const ENDED_SEASON_NO_SNAPSHOT = {
  id: "season-2",
  name: "Season 2",
  slug: "s2",
  start_date: "2026-01-01T00:00:00Z",
  end_date: "2026-01-31T23:59:00Z",
  snapshot_ready: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/seasons/[seasonId]/leaderboard", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
  });

  it("should return teams ranked by total_tokens", async () => {
    // Season lookup (snapshot_ready=0 → live aggregation)
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
    // Live aggregation: two teams
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([
      {
        team_id: "team-a",
        team_name: "Team Alpha",
        team_slug: "team-alpha",
        team_logo_url: null,
        total_tokens: 15000,
        input_tokens: 10000,
        output_tokens: 5000,
        cached_input_tokens: 3000,
      },
      {
        team_id: "team-b",
        team_name: "Team Beta",
        team_slug: "team-beta",
        team_logo_url: null,
        total_tokens: 8000,
        input_tokens: 5000,
        output_tokens: 3000,
        cached_input_tokens: 1000,
      },
    ]);
    // Session stats (empty)
    mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(data.entries).toHaveLength(2);
    expect(data.entries[0].rank).toBe(1);
    expect(data.entries[0].team.name).toBe("Team Alpha");
    expect(data.entries[0].total_tokens).toBe(15000);
    expect(data.entries[1].rank).toBe(2);
    expect(data.entries[1].team.name).toBe("Team Beta");
  });

  it("should call getSeasonTeamTokens with correct date range", async () => {
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

    await GET(makeRequest(), { params: routeParams });

    // Verify RPC was called with correct date params
    expect(mockDbRead.getSeasonTeamTokens).toHaveBeenCalledTimes(1);
    expect(mockDbRead.getSeasonTeamTokens).toHaveBeenCalledWith(
      "season-1",
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z"
    );
  });

  it("should include end_date in the range (inclusive)", async () => {
    const season = {
      ...ACTIVE_SEASON,
      start_date: "2026-03-01T00:00:00Z",
      end_date: "2026-03-15T23:59:00Z",
    };
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(season);
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

    await GET(makeRequest(), { params: routeParams });

    // end_date 2026-03-15T23:59:00Z + 1 minute → exclusive bound
    expect(mockDbRead.getSeasonTeamTokens).toHaveBeenCalledWith(
      "season-1",
      "2026-03-01T00:00:00.000Z",
      "2026-03-16T00:00:00.000Z"
    );
  });

  it("should return empty entries for season with no registered teams", async () => {
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entries).toHaveLength(0);
    expect(data.season.is_snapshot).toBe(false);
  });

  it("should return member breakdown when expand=members", async () => {
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
    // Team aggregation
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([
      {
        team_id: "team-a",
        team_name: "Team Alpha",
        team_slug: "team-alpha",
        team_logo_url: null,
        total_tokens: 15000,
        input_tokens: 10000,
        output_tokens: 5000,
        cached_input_tokens: 3000,
      },
    ]);
    // Member breakdown
    mockDbRead.getSeasonMemberTokens.mockResolvedValueOnce([
      {
        team_id: "team-a",
        user_id: "user-1",
        slug: "alice",
        name: "Alice",
        nickname: "Ally",
        image: "https://img/alice.png",
        is_public: 1,
        total_tokens: 9000,
        input_tokens: 6000,
        output_tokens: 3000,
        cached_input_tokens: 2000,
      },
      {
        team_id: "team-a",
        user_id: "user-2",
        slug: "bob",
        name: "Bob",
        nickname: null,
        image: null,
        is_public: 1,
        total_tokens: 6000,
        input_tokens: 4000,
        output_tokens: 2000,
        cached_input_tokens: 1000,
      },
    ]);
    // Session stats (empty)
    mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([]);
    mockDbRead.getSeasonMemberSessionStats.mockResolvedValueOnce([]);

    const url =
      "http://localhost:7020/api/seasons/season-1/leaderboard?expand=members";
    const res = await GET(makeRequest(url), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entries[0].members).toHaveLength(2);
    // user_id must be present (used as React key in frontend)
    expect(data.entries[0].members[0].user_id).toBe("user-1");
    expect(data.entries[0].members[1].user_id).toBe("user-2");
    // nickname preferred over name
    expect(data.entries[0].members[0].name).toBe("Ally");
    expect(data.entries[0].members[0].total_tokens).toBe(9000);
    // fallback to name when nickname is null
    expect(data.entries[0].members[1].name).toBe("Bob");
  });

  it("should NOT return members when expand is not set", async () => {
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([
      {
        team_id: "team-a",
        team_name: "Team Alpha",
        team_slug: "team-alpha",
        team_logo_url: null,
        total_tokens: 15000,
        input_tokens: 10000,
        output_tokens: 5000,
        cached_input_tokens: 3000,
      },
    ]);
    mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entries[0]).not.toHaveProperty("members");
    // Verify member RPC was not called
    expect(mockDbRead.getSeasonMemberTokens).not.toHaveBeenCalled();
  });

  it("should read from snapshot tables when snapshot exists", async () => {
    // ENDED_SEASON has snapshot_ready=1
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ENDED_SEASON);
    // Snapshot data
    mockDbRead.getSeasonSnapshots.mockResolvedValueOnce([
      {
        team_id: "team-a",
        team_name: "Team Alpha",
        team_slug: "team-alpha",
        team_logo_url: null,
        rank: 1,
        total_tokens: 20000,
        input_tokens: 12000,
        output_tokens: 8000,
        cached_input_tokens: 5000,
      },
      {
        team_id: "team-b",
        team_name: "Team Beta",
        team_slug: "team-beta",
        team_logo_url: null,
        rank: 2,
        total_tokens: 10000,
        input_tokens: 6000,
        output_tokens: 4000,
        cached_input_tokens: 2000,
      },
    ]);
    mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.season.is_snapshot).toBe(true);
    expect(data.entries[0].rank).toBe(1);
    expect(data.entries[0].team.name).toBe("Team Alpha");
    expect(data.entries[1].rank).toBe(2);

    // Verify snapshot RPC was used (not live aggregation)
    expect(mockDbRead.getSeasonSnapshots).toHaveBeenCalledTimes(1);
    expect(mockDbRead.getSeasonTeamTokens).not.toHaveBeenCalled();
  });

  it("should include user_id in snapshot member breakdown", async () => {
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ENDED_SEASON);
    // Snapshot team data
    mockDbRead.getSeasonSnapshots.mockResolvedValueOnce([
      {
        team_id: "team-a",
        team_name: "Team Alpha",
        team_slug: "team-alpha",
        team_logo_url: null,
        rank: 1,
        total_tokens: 20000,
        input_tokens: 12000,
        output_tokens: 8000,
        cached_input_tokens: 5000,
      },
    ]);
    // Snapshot member data
    mockDbRead.getSeasonMemberSnapshots.mockResolvedValueOnce([
      {
        team_id: "team-a",
        user_id: "user-x",
        slug: "xena",
        name: "Xena",
        nickname: null,
        image: null,
        is_public: 1,
        total_tokens: 20000,
        input_tokens: 12000,
        output_tokens: 8000,
        cached_input_tokens: 5000,
      },
    ]);
    mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([]);
    mockDbRead.getSeasonMemberSessionStats.mockResolvedValueOnce([]);

    const url =
      "http://localhost:7020/api/seasons/season-1/leaderboard?expand=members";
    const res = await GET(makeRequest(url), {
      params: Promise.resolve({ seasonId: "season-2" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.season.is_snapshot).toBe(true);
    expect(data.entries[0].members).toHaveLength(1);
    expect(data.entries[0].members[0].user_id).toBe("user-x");
    expect(data.entries[0].members[0].name).toBe("Xena");
  });

  it("should aggregate live when no snapshot exists", async () => {
    // ENDED_SEASON_NO_SNAPSHOT has snapshot_ready=0
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ENDED_SEASON_NO_SNAPSHOT);
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.season.is_snapshot).toBe(false);

    // Verify the live aggregation RPC was used (not snapshot)
    expect(mockDbRead.getSeasonTeamTokens).toHaveBeenCalledTimes(1);
    expect(mockDbRead.getSeasonSnapshots).not.toHaveBeenCalled();
  });

  it("should use getSeasonById/getSeasonBySlug RPC methods for season lookup", async () => {
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
    mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

    await GET(makeRequest(), { params: routeParams });

    // Verify RPC method was called
    expect(mockDbRead.getSeasonBySlug).toHaveBeenCalledTimes(1);
    expect(mockDbRead.getSeasonBySlug).toHaveBeenCalledWith("season-1");
  });

  // -------------------------------------------------------------------------
  // UUID vs slug branch coverage
  // -------------------------------------------------------------------------

  describe("UUID vs slug season lookup", () => {
    const UUID_SEASON_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const SLUG_SEASON_ID = "s1";

    it("should use getSeasonById when seasonId is a UUID", async () => {
      mockDbRead.getSeasonById.mockResolvedValueOnce(ACTIVE_SEASON);
      mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

      const req = makeRequest(
        `http://localhost:7020/api/seasons/${UUID_SEASON_ID}/leaderboard`
      );
      await GET(req, {
        params: Promise.resolve({ seasonId: UUID_SEASON_ID }),
      });

      expect(mockDbRead.getSeasonById).toHaveBeenCalledTimes(1);
      expect(mockDbRead.getSeasonById).toHaveBeenCalledWith(UUID_SEASON_ID);
      expect(mockDbRead.getSeasonBySlug).not.toHaveBeenCalled();
    });

    it("should use getSeasonBySlug when seasonId is a slug", async () => {
      mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
      mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

      const req = makeRequest(
        `http://localhost:7020/api/seasons/${SLUG_SEASON_ID}/leaderboard`
      );
      await GET(req, {
        params: Promise.resolve({ seasonId: SLUG_SEASON_ID }),
      });

      expect(mockDbRead.getSeasonBySlug).toHaveBeenCalledTimes(1);
      expect(mockDbRead.getSeasonBySlug).toHaveBeenCalledWith(SLUG_SEASON_ID);
      expect(mockDbRead.getSeasonById).not.toHaveBeenCalled();
    });

    it("should return identical response shape for UUID and slug lookups", async () => {
      // UUID lookup
      mockDbRead.getSeasonById.mockResolvedValueOnce(ACTIVE_SEASON);
      mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          team_logo_url: null,
          total_tokens: 5000,
          input_tokens: 3000,
          output_tokens: 2000,
          cached_input_tokens: 1000,
        },
      ]);
      mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([]);

      const uuidRes = await GET(
        makeRequest(
          `http://localhost:7020/api/seasons/${UUID_SEASON_ID}/leaderboard`
        ),
        { params: Promise.resolve({ seasonId: UUID_SEASON_ID }) }
      );
      const uuidData = await uuidRes.json();

      vi.clearAllMocks();
      mockDbRead = createMockDbRead();
      vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);

      // Slug lookup — same mock data
      mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
      mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          team_logo_url: null,
          total_tokens: 5000,
          input_tokens: 3000,
          output_tokens: 2000,
          cached_input_tokens: 1000,
        },
      ]);
      mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([]);

      const slugRes = await GET(
        makeRequest(
          `http://localhost:7020/api/seasons/${SLUG_SEASON_ID}/leaderboard`
        ),
        { params: Promise.resolve({ seasonId: SLUG_SEASON_ID }) }
      );
      const slugData = await slugRes.json();

      // Both should have identical shapes
      expect(uuidRes.status).toBe(200);
      expect(slugRes.status).toBe(200);
      expect(Object.keys(uuidData)).toEqual(Object.keys(slugData));
      expect(Object.keys(uuidData.season)).toEqual(Object.keys(slugData.season));
      expect(uuidData.entries).toHaveLength(1);
      expect(slugData.entries).toHaveLength(1);
      expect(Object.keys(uuidData.entries[0])).toEqual(
        Object.keys(slugData.entries[0])
      );
    });

    it("should treat uppercase UUID as UUID (case-insensitive)", async () => {
      const upperUUID = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
      mockDbRead.getSeasonById.mockResolvedValueOnce(ACTIVE_SEASON);
      mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([]);

      await GET(
        makeRequest(
          `http://localhost:7020/api/seasons/${upperUUID}/leaderboard`
        ),
        { params: Promise.resolve({ seasonId: upperUUID }) }
      );

      expect(mockDbRead.getSeasonById).toHaveBeenCalledTimes(1);
      expect(mockDbRead.getSeasonBySlug).not.toHaveBeenCalled();
    });
  });

  it("should return 404 for non-existent season", async () => {
    mockDbRead.getSeasonBySlug.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("Season not found");
  });

  it("should handle no-such-table gracefully", async () => {
    mockDbRead.getSeasonBySlug.mockRejectedValueOnce(
      new Error("no such table: seasons")
    );

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain("not yet migrated");
  });

  // -------------------------------------------------------------------------
  // Session stats enrichment tests
  // -------------------------------------------------------------------------

  describe("session stats enrichment", () => {
    it("should enrich entries with team session stats", async () => {
      mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
      mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          team_logo_url: null,
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
      ]);
      mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([
        {
          team_id: "team-a",
          session_count: 42,
          total_duration_seconds: 3600,
        },
      ]);

      const res = await GET(makeRequest(), { params: routeParams });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.entries[0].session_count).toBe(42);
      expect(data.entries[0].total_duration_seconds).toBe(3600);
    });

    it("should enrich member entries with session stats when expand=members", async () => {
      mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ACTIVE_SEASON);
      mockDbRead.getSeasonTeamTokens.mockResolvedValueOnce([
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          team_logo_url: null,
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
      ]);
      mockDbRead.getSeasonMemberTokens.mockResolvedValueOnce([
        {
          team_id: "team-a",
          user_id: "user-1",
          slug: "alice",
          name: "Alice",
          nickname: null,
          image: null,
          is_public: 1,
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
      ]);
      mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([
        {
          team_id: "team-a",
          session_count: 42,
          total_duration_seconds: 3600,
        },
      ]);
      mockDbRead.getSeasonMemberSessionStats.mockResolvedValueOnce([
        {
          team_id: "team-a",
          user_id: "user-1",
          session_count: 20,
          total_duration_seconds: 1800,
        },
      ]);

      const url =
        "http://localhost:7020/api/seasons/season-1/leaderboard?expand=members";
      const res = await GET(makeRequest(url), { params: routeParams });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.entries[0].session_count).toBe(42);
      expect(data.entries[0].members[0].session_count).toBe(20);
      expect(data.entries[0].members[0].total_duration_seconds).toBe(1800);
    });
  });

  describe("snapshot session stats enrichment", () => {
    it("should enrich snapshot entries with team session stats", async () => {
      mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ENDED_SEASON);
      mockDbRead.getSeasonSnapshots.mockResolvedValueOnce([
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          team_logo_url: null,
          rank: 1,
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
      ]);
      mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([
        {
          team_id: "team-a",
          session_count: 10,
          total_duration_seconds: 600,
        },
      ]);

      const res = await GET(makeRequest(), { params: routeParams });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.entries[0].session_count).toBe(10);
      expect(data.entries[0].total_duration_seconds).toBe(600);
    });

    it("should enrich snapshot member entries with session stats", async () => {
      mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ENDED_SEASON);
      mockDbRead.getSeasonSnapshots.mockResolvedValueOnce([
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          team_logo_url: null,
          rank: 1,
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
      ]);
      mockDbRead.getSeasonMemberSnapshots.mockResolvedValueOnce([
        {
          team_id: "team-a",
          user_id: "user-1",
          slug: "alice",
          name: "Alice",
          nickname: null,
          image: null,
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
      ]);
      mockDbRead.getSeasonTeamSessionStats.mockResolvedValueOnce([
        { team_id: "team-a", session_count: 10, total_duration_seconds: 600 },
      ]);
      mockDbRead.getSeasonMemberSessionStats.mockResolvedValueOnce([
        { team_id: "team-a", user_id: "user-1", session_count: 5, total_duration_seconds: 300 },
      ]);

      const url = "http://localhost:7020/api/seasons/season-1/leaderboard?expand=members";
      const res = await GET(makeRequest(url), { params: routeParams });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.entries[0].session_count).toBe(10);
      expect(data.entries[0].members[0].session_count).toBe(5);
      expect(data.entries[0].members[0].total_duration_seconds).toBe(300);
    });

    it("should silently skip session stats when session_records table missing", async () => {
      mockDbRead.getSeasonBySlug.mockResolvedValueOnce(ENDED_SEASON);
      mockDbRead.getSeasonSnapshots.mockResolvedValueOnce([
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          team_logo_url: null,
          rank: 1,
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
      ]);
      mockDbRead.getSeasonTeamSessionStats.mockRejectedValueOnce(
        new Error("no such table: session_records"),
      );

      const res = await GET(makeRequest(), { params: routeParams });
      const data = await res.json();

      expect(res.status).toBe(200);
      // Session stats default to 0
      expect(data.entries[0].session_count).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should return 503 when season tables not migrated", async () => {
      mockDbRead.getSeasonBySlug.mockRejectedValueOnce(
        new Error("no such table: seasons"),
      );

      const res = await GET(makeRequest(), { params: routeParams });
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toContain("not yet migrated");
    });

    it("should return 500 on unexpected error", async () => {
      mockDbRead.getSeasonBySlug.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(makeRequest(), { params: routeParams });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Failed to load");
    });
  });
});

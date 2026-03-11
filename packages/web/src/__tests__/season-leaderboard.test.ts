import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/d1", () => ({
  getD1Client: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { GET } from "@/app/api/seasons/[seasonId]/leaderboard/route";
import * as d1Module from "@/lib/d1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

function makeRequest(
  url = "http://localhost:7030/api/seasons/season-1/leaderboard"
): Request {
  return new Request(url, { method: "GET" });
}

const routeParams = Promise.resolve({ seasonId: "season-1" });

// Active season: start in the past, end in the future (no snapshot)
const ACTIVE_SEASON = {
  id: "season-1",
  name: "Season 1",
  slug: "s1",
  start_date: "2026-03-01",
  end_date: "2026-03-31",
  snapshot_ready: 0,
};

// Ended season with snapshot ready
const ENDED_SEASON = {
  id: "season-2",
  name: "Season 2",
  slug: "s2",
  start_date: "2026-01-01",
  end_date: "2026-01-31",
  snapshot_ready: 1,
};

// Ended season without snapshot
const ENDED_SEASON_NO_SNAPSHOT = {
  id: "season-2",
  name: "Season 2",
  slug: "s2",
  start_date: "2026-01-01",
  end_date: "2026-01-31",
  snapshot_ready: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/seasons/[seasonId]/leaderboard", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client
    );
  });

  it("should return teams ranked by total_tokens", async () => {
    // Season lookup (snapshot_ready=0 → live aggregation)
    mockClient.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);
    // Live aggregation: two teams
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
        {
          team_id: "team-b",
          team_name: "Team Beta",
          team_slug: "team-beta",
          total_tokens: 8000,
          input_tokens: 5000,
          output_tokens: 3000,
          cached_input_tokens: 1000,
        },
      ],
    });

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entries).toHaveLength(2);
    expect(data.entries[0].rank).toBe(1);
    expect(data.entries[0].team.name).toBe("Team Alpha");
    expect(data.entries[0].total_tokens).toBe(15000);
    expect(data.entries[1].rank).toBe(2);
    expect(data.entries[1].team.name).toBe("Team Beta");
  });

  it("should only include usage within season date range", async () => {
    mockClient.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);
    mockClient.query.mockResolvedValueOnce({ results: [] });

    await GET(makeRequest(), { params: routeParams });

    // Verify date params passed to live aggregation query
    const queryCall = mockClient.query.mock.calls[0]!;
    const params = queryCall[1] as string[];
    // First param: start_date inclusive
    expect(params[0]).toBe("2026-03-01 00:00:00");
    // Second param: end_date exclusive (next day)
    expect(params[1]).toBe("2026-04-01 00:00:00");
  });

  it("should include end_date in the range (inclusive)", async () => {
    const season = {
      ...ACTIVE_SEASON,
      start_date: "2026-03-01",
      end_date: "2026-03-15",
    };
    mockClient.firstOrNull.mockResolvedValueOnce(season);
    mockClient.query.mockResolvedValueOnce({ results: [] });

    await GET(makeRequest(), { params: routeParams });

    const params = mockClient.query.mock.calls[0]![1] as string[];
    // end_date 2026-03-15 → exclusive bound should be 2026-03-16
    expect(params[1]).toBe("2026-03-16 00:00:00");
  });

  it("should return empty entries for season with no registered teams", async () => {
    mockClient.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);
    mockClient.query.mockResolvedValueOnce({ results: [] });

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entries).toHaveLength(0);
    expect(data.season.is_snapshot).toBe(false);
  });

  it("should return member breakdown when expand=members", async () => {
    mockClient.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);
    // Team aggregation
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
      ],
    });
    // Member breakdown
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          user_id: "user-1",
          name: "Alice",
          nickname: "Ally",
          image: "https://img/alice.png",
          total_tokens: 9000,
          input_tokens: 6000,
          output_tokens: 3000,
          cached_input_tokens: 2000,
        },
        {
          team_id: "team-a",
          user_id: "user-2",
          name: "Bob",
          nickname: null,
          image: null,
          total_tokens: 6000,
          input_tokens: 4000,
          output_tokens: 2000,
          cached_input_tokens: 1000,
        },
      ],
    });

    const url =
      "http://localhost:7030/api/seasons/season-1/leaderboard?expand=members";
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
    mockClient.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          total_tokens: 15000,
          input_tokens: 10000,
          output_tokens: 5000,
          cached_input_tokens: 3000,
        },
      ],
    });

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entries[0]).not.toHaveProperty("members");
  });

  it("should read from snapshot tables when snapshot exists", async () => {
    // ENDED_SEASON has snapshot_ready=1
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Snapshot data
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
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
          rank: 2,
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 2000,
        },
      ],
    });

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.season.is_snapshot).toBe(true);
    expect(data.entries[0].rank).toBe(1);
    expect(data.entries[0].team.name).toBe("Team Alpha");
    expect(data.entries[1].rank).toBe(2);

    // Verify the snapshot query was used (queries season_snapshots)
    const sql = mockClient.query.mock.calls[0]![0] as string;
    expect(sql).toContain("season_snapshots");
  });

  it("should include user_id in snapshot member breakdown", async () => {
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON);
    // Snapshot team data
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          team_name: "Team Alpha",
          team_slug: "team-alpha",
          rank: 1,
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
      ],
    });
    // Snapshot member data
    mockClient.query.mockResolvedValueOnce({
      results: [
        {
          team_id: "team-a",
          user_id: "user-x",
          name: "Xena",
          nickname: null,
          image: null,
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 8000,
          cached_input_tokens: 5000,
        },
      ],
    });

    const url =
      "http://localhost:7030/api/seasons/season-1/leaderboard?expand=members";
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
    mockClient.firstOrNull.mockResolvedValueOnce(ENDED_SEASON_NO_SNAPSHOT);
    mockClient.query.mockResolvedValueOnce({ results: [] });

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.season.is_snapshot).toBe(false);

    // Verify the live aggregation query was used (queries usage_records)
    const sql = mockClient.query.mock.calls[0]![0] as string;
    expect(sql).toContain("usage_records");
  });

  it("should read snapshot_ready from season row instead of separate COUNT query", async () => {
    mockClient.firstOrNull.mockResolvedValueOnce(ACTIVE_SEASON);
    mockClient.query.mockResolvedValueOnce({ results: [] });

    await GET(makeRequest(), { params: routeParams });

    // Only one firstOrNull call (season lookup) — no separate COUNT(*) query
    expect(mockClient.firstOrNull).toHaveBeenCalledTimes(1);
    const sql = mockClient.firstOrNull.mock.calls[0]![0] as string;
    expect(sql).toContain("snapshot_ready");
  });

  it("should return 404 for non-existent season", async () => {
    mockClient.firstOrNull.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("Season not found");
  });

  it("should handle no-such-table gracefully", async () => {
    mockClient.firstOrNull.mockRejectedValueOnce(
      new Error("no such table: seasons")
    );

    const res = await GET(makeRequest(), { params: routeParams });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain("not yet migrated");
  });
});

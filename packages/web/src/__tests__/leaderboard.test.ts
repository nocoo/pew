import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/leaderboard/route";
import * as dbModule from "@/lib/db";
import { createMockDbRead, makeGetRequest } from "./test-utils";

// Mock DB
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

// Mock auth-helpers for scoped leaderboard tests
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

describe("GET /api/leaderboard", () => {
  let mockDb: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDb as any);
    // Default: no badges assigned
    mockDb.getActiveBadgesForUsers.mockResolvedValue({});
    // Default to authenticated user for scope tests
    resolveUser.mockResolvedValue({ userId: "test-user" });
  });

  describe("query params validation", () => {
    it("should reject invalid period", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { period: "year" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid period");
    });

    it("should accept valid periods", async () => {
      for (const period of ["week", "month", "all"]) {
        mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
        mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);
        const res = await GET(makeGetRequest("/api/leaderboard", { period }));
        expect(res.status).toBe(200);
      }
    });

    it("should reject limit < 1", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { limit: "0" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("limit must be");
    });

    it("should reject limit > 100", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { limit: "200" }));

      expect(res.status).toBe(400);
    });

    it("should reject non-numeric limit", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { limit: "abc" }));

      expect(res.status).toBe(400);
    });

    it("should reject negative offset", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { offset: "-1" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("offset must be");
    });

    it("should reject non-numeric offset", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { offset: "abc" }));

      expect(res.status).toBe(400);
    });

    it("should accept valid offset", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { offset: "20" }));

      expect(res.status).toBe(200);
      expect(mockDb.getGlobalLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: 20,
        }),
      );
    });
  });

  describe("default behavior", () => {
    it("should default to period=week and limit=20", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.period).toBe("week");
      expect(body.entries).toEqual([]);
      expect(body.hasMore).toBe(false);

      // Check RPC call includes fromDate (week has a date condition)
      // limit is requested as limit+1 to detect hasMore
      expect(mockDb.getGlobalLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({
          fromDate: expect.any(String),
          limit: 21, // DEFAULT_LIMIT (20) + 1
        }),
      );
    });
  });

  describe("successful response", () => {
    it("should return ranked entries with user info and teams", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1",
          name: "Alice",
          nickname: null,
          image: "https://example.com/alice.jpg",
          slug: "alice",
          total_tokens: 5000000,
          input_tokens: 3000000,
          output_tokens: 1500000,
          cached_input_tokens: 500000,
        },
        {
          user_id: "u2",
          name: "Bob",
          nickname: null,
          image: null,
          slug: "bob",
          total_tokens: 3000000,
          input_tokens: 2000000,
          output_tokens: 800000,
          cached_input_tokens: 200000,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([
        { user_id: "u1", team_id: "t1", team_name: "Team Alpha", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" },
        { user_id: "u2", team_id: "t1", team_name: "Team Alpha", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" },
        { user_id: "u2", team_id: "t2", team_name: "Team Beta", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t2/def.jpg" },
      ]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { period: "month" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.period).toBe("month");
      expect(body.entries).toHaveLength(2);

      expect(body.entries[0]).toEqual({
        rank: 1,
        user: {
          id: "u1",
          name: "Alice",
          image: "https://example.com/alice.jpg",
          slug: "alice",
        },
        teams: [{ id: "t1", name: "Team Alpha", logoUrl: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" }],
        badges: [],
        total_tokens: 5000000,
        input_tokens: 3000000,
        output_tokens: 1500000,
        cached_input_tokens: 500000,
        session_count: 0,
        total_duration_seconds: 0,
      });

      expect(body.entries[1].rank).toBe(2);
      expect(body.entries[1].user.name).toBe("Bob");
      expect(body.entries[1].teams).toEqual([
        { id: "t1", name: "Team Alpha", logoUrl: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" },
        { id: "t2", name: "Team Beta", logoUrl: "https://s.zhe.to/apps/pew/teams-logo/t2/def.jpg" },
      ]);
    });

    it("should not include date filter for period=all", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      await GET(makeGetRequest("/api/leaderboard", { period: "all" }));

      // With conditional spread, fromDate is omitted (not present) for period=all
      const callArg = mockDb.getGlobalLeaderboard.mock.calls[0]?.[0];
      expect(callArg).not.toHaveProperty("fromDate");
    });

    it("should pass limit to RPC (with +1 for hasMore detection)", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      await GET(makeGetRequest("/api/leaderboard", { limit: "10" }));

      expect(mockDb.getGlobalLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 11, // requested limit + 1
        }),
      );
    });

    it("should include active badges for users", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1",
          name: "Alice",
          nickname: null,
          image: null,
          slug: "alice",
          total_tokens: 5000000,
          input_tokens: 3000000,
          output_tokens: 1500000,
          cached_input_tokens: 500000,
        },
        {
          user_id: "u2",
          name: "Bob",
          nickname: null,
          image: null,
          slug: "bob",
          total_tokens: 3000000,
          input_tokens: 2000000,
          output_tokens: 800000,
          cached_input_tokens: 200000,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);
      mockDb.getActiveBadgesForUsers.mockResolvedValueOnce({
        u1: [
          {
            id: "ba1",
            text: "MVP",
            icon: "shield",
            color_bg: "#3B82F6",
            color_text: "#FFFFFF",
            assigned_at: "2026-04-10T00:00:00Z",
            expires_at: "2026-04-17T00:00:00Z",
          },
        ],
        // u2 has no badges
      });

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.entries[0].badges).toEqual([
        {
          text: "MVP",
          icon: "shield",
          colorBg: "#3B82F6",
          colorText: "#FFFFFF",
        },
      ]);
      expect(body.entries[1].badges).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should return 500 on D1 failure", async () => {
      mockDb.getGlobalLeaderboard.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(makeGetRequest("/api/leaderboard"));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to load leaderboard");
    });
  });

  describe("team filter", () => {
    it("should pass teamId when team param is provided", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      expect(res.status).toBe(200);
      expect(mockDb.getGlobalLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: "team-abc",
        }),
      );
    });

    it("should silently ignore team param for anonymous users", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("global");
      // Should NOT have team filter - with conditional spread, teamId is omitted entirely
      const callArg = mockDb.getGlobalLeaderboard.mock.calls[0]?.[0];
      expect(callArg).not.toHaveProperty("teamId");
    });

    it("should set Cache-Control: private, no-store for anonymous team-scoped request", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      expect(res.status).toBe(200);
      // Even though data is global, scope param was present so must not be public cached
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });

  describe("nickname fallback", () => {
    it("should use nickname when available", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1",
          name: "Alice Smith",
          nickname: "alice",
          image: null,
          slug: "alice-s",
          total_tokens: 1000,
          input_tokens: 500,
          output_tokens: 400,
          cached_input_tokens: 100,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].user.name).toBe("alice");
    });

    it("should fall back to name when nickname is null", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1",
          name: "Bob Jones",
          nickname: null,
          image: null,
          slug: "bob",
          total_tokens: 1000,
          input_tokens: 500,
          output_tokens: 400,
          cached_input_tokens: 100,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].user.name).toBe("Bob Jones");
    });
  });

  describe("organization filter", () => {
    it("should pass orgId when org param is provided", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.scope).toBe("org");
      expect(body.scopeId).toBe("org-123");

      expect(mockDb.getGlobalLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
    });

    it("should return 400 when both org and team are provided", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123", team: "team-abc" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Cannot specify both");
    });

    it("should silently ignore org param for anonymous users", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("global");
      expect(body.scopeId).toBeUndefined();
      // Should NOT have org filter - with conditional spread, orgId is omitted entirely
      const callArg = mockDb.getGlobalLeaderboard.mock.calls[0]?.[0];
      expect(callArg).not.toHaveProperty("orgId");
    });

    it("should set Cache-Control: private, no-store for anonymous org-scoped request", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(200);
      // Even though data is global, scope param was present so must not be public cached
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("should set Cache-Control: private, no-store for org-scoped leaderboard", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });

  describe("response shape", () => {
    it("should include scope='global' when no scope params", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("global");
      expect(body.scopeId).toBeUndefined();
    });

    it("should include scope='team' and scopeId when team param is provided", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-xyz" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("team");
      expect(body.scopeId).toBe("team-xyz");
    });

    it("should include scope='org' and scopeId when org param is provided", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-abc" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("org");
      expect(body.scopeId).toBe("org-abc");
    });
  });

  describe("cache headers", () => {
    it("should set cache headers for public leaderboard", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard"));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=120",
      );
    });

    it("should NOT set cache headers for team-scoped leaderboard", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "private, no-store",
      );
    });
  });

  describe("teams in response", () => {
    it("should return empty teams array when no results", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.entries).toEqual([]);
    });

    it("should fetch teams for leaderboard users", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1",
          name: "Alice",
          nickname: null,
          image: null,
          slug: null,
          total_tokens: 1000,
          input_tokens: 500,
          output_tokens: 400,
          cached_input_tokens: 100,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([
        { user_id: "u1", team_id: "t1", team_name: "Eng", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/xyz.jpg" },
      ]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].teams).toEqual([{ id: "t1", name: "Eng", logoUrl: "https://s.zhe.to/apps/pew/teams-logo/t1/xyz.jpg" }]);
      expect(mockDb.getLeaderboardUserTeams).toHaveBeenCalledWith(["u1"]);
    });
  });

  describe("session stats in response", () => {
    it("should include session stats for users", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1",
          name: "Alice",
          nickname: null,
          image: null,
          slug: "alice",
          total_tokens: 1000,
          input_tokens: 500,
          output_tokens: 400,
          cached_input_tokens: 100,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([
        { user_id: "u1", session_count: 42, total_duration_seconds: 3600 },
      ]);

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].session_count).toBe(42);
      expect(body.entries[0].total_duration_seconds).toBe(3600);
    });

    it("should default session stats to 0 when not found", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1",
          name: "Alice",
          nickname: null,
          image: null,
          slug: "alice",
          total_tokens: 1000,
          input_tokens: 500,
          output_tokens: 400,
          cached_input_tokens: 100,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]); // No stats for u1

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].session_count).toBe(0);
      expect(body.entries[0].total_duration_seconds).toBe(0);
    });
  });

  describe("source/model filters", () => {
    it("should reject invalid source", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { source: "not-a-real-agent" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid source");
    });

    it("should reject both source and model together", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { source: "claude-code", model: "o3" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Cannot specify both source and model");
    });

    it("should pass source filter to getGlobalLeaderboard", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { source: "claude-code" }));

      expect(res.status).toBe(200);
      expect(mockDb.getGlobalLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({ source: "claude-code" }),
      );
    });

    it("should pass source filter to getLeaderboardSessionStats", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1", name: "Alice", nickname: null, image: null,
          slug: "alice", total_tokens: 1000, input_tokens: 500,
          output_tokens: 400, cached_input_tokens: 100,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      await GET(makeGetRequest("/api/leaderboard", { source: "codex" }));

      expect(mockDb.getLeaderboardSessionStats).toHaveBeenCalledWith(
        ["u1"],
        expect.any(String), // fromDate
        "codex",
      );
    });

    it("should pass model filter to getGlobalLeaderboard", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { model: "claude-sonnet-4-20250514" }));

      expect(res.status).toBe(200);
      expect(mockDb.getGlobalLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-sonnet-4-20250514" }),
      );
    });

    it("should skip session stats and return null when model filter is active", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([
        {
          user_id: "u1", name: "Alice", nickname: null, image: null,
          slug: "alice", total_tokens: 1000, input_tokens: 500,
          output_tokens: 400, cached_input_tokens: 100,
        },
      ]);
      mockDb.getLeaderboardUserTeams.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { model: "o3" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      // Session stats should be null, not 0
      expect(body.entries[0].session_count).toBeNull();
      expect(body.entries[0].total_duration_seconds).toBeNull();
      // getLeaderboardSessionStats should NOT have been called
      expect(mockDb.getLeaderboardSessionStats).not.toHaveBeenCalled();
    });

    it("should use public cache for source-filtered requests", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { source: "claude-code" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=120",
      );
    });

    it("should use public cache for model-filtered requests", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { model: "gpt-4.1" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=120",
      );
    });

    it("should use private cache when source + team are combined", async () => {
      mockDb.getGlobalLeaderboard.mockResolvedValueOnce([]);
      mockDb.getLeaderboardSessionStats.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/leaderboard", { source: "claude-code", team: "t1" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });
});

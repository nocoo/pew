import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/leaderboard/route";
import * as dbModule from "@/lib/db";
import { createMockClient, makeGetRequest } from "./test-utils";

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
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockClient as any);
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
        mockClient.query
          .mockResolvedValueOnce({ results: [] })  // leaderboard query
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
  });

  describe("default behavior", () => {
    it("should default to period=week and limit=100", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.period).toBe("week");
      expect(body.entries).toEqual([]);

      // Check SQL includes date filter (week has a date condition)
      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).toContain("ur.hour_start >= ?");
    });
  });

  describe("successful response", () => {
    it("should return ranked entries with user info and teams", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          results: [
            {
              user_id: "u1",
              name: "Alice",
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
              image: null,
              slug: "bob",
              total_tokens: 3000000,
              input_tokens: 2000000,
              output_tokens: 800000,
              cached_input_tokens: 200000,
            },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            { user_id: "u1", team_id: "t1", team_name: "Team Alpha", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" },
            { user_id: "u2", team_id: "t1", team_name: "Team Alpha", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" },
            { user_id: "u2", team_id: "t2", team_name: "Team Beta", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t2/def.jpg" },
          ],
        });

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
        teams: [{ id: "t1", name: "Team Alpha", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" }],
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
        { id: "t1", name: "Team Alpha", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" },
        { id: "t2", name: "Team Beta", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t2/def.jpg" },
      ]);
    });

    it("should not include date filter for period=all", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      await GET(makeGetRequest("/api/leaderboard", { period: "all" }));

      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).not.toContain("ur.hour_start >= ?");
    });

    it("should filter by is_public = 1 (no slug requirement)", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      await GET(makeGetRequest("/api/leaderboard"));

      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).toContain("u.is_public = 1");
      // slug IS NOT NULL was removed — all public users shown regardless of slug
      expect(sqlCall[0]).not.toContain("u.slug IS NOT NULL");
    });

    it("should filter out users with 0 total_tokens via HAVING", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      await GET(makeGetRequest("/api/leaderboard"));

      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).toContain("HAVING total_tokens > 0");
    });

    it("should pass limit to SQL", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      await GET(makeGetRequest("/api/leaderboard", { limit: "10" }));

      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).toContain("LIMIT ?");
      expect(sqlCall[1]).toContain(10);
    });
  });

  describe("error handling", () => {
    it("should return 500 on D1 failure", async () => {
      mockClient.query.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(makeGetRequest("/api/leaderboard"));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to load leaderboard");
    });
  });

  describe("team filter", () => {
    it("should add EXISTS filter when team param is provided", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      expect(res.status).toBe(200);
      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).toContain("EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = ur.user_id AND tm.team_id = ?)");
      expect(sqlCall[1]).toContain("team-abc");
    });

    it("should include is_public filter even when team is set (opt-out respected)", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      const sqlCall = mockClient.query.mock.calls[0]!;
      // Team filter still respects user opt-out
      expect(sqlCall[0]).toContain("u.is_public = 1");
    });

    it("should silently ignore team param for anonymous users", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("global");
      // Should NOT have team filter in SQL
      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).not.toContain("team_members");
    });

    it("should set Cache-Control: private, no-store for anonymous team-scoped request", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      expect(res.status).toBe(200);
      // Even though data is global, scope param was present so must not be public cached
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });

  describe("nickname fallback", () => {
    it("should retry without nickname when first query throws 'no such column: nickname'", async () => {
      mockClient.query
        .mockRejectedValueOnce(new Error("no such column: u.nickname"))
        .mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard"));

      expect(res.status).toBe(200);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
      // Level 1 fallback: no nickname but preserves is_public filter
      const fallbackSql = mockClient.query.mock.calls[1]![0] as string;
      expect(fallbackSql).not.toContain("u.nickname");
      expect(fallbackSql).toContain("u.is_public = 1");
    });

    it("should fail closed when is_public column is missing (no bare fallback)", async () => {
      // Both queries fail because is_public column is missing — fail closed, don't bypass opt-out
      mockClient.query
        .mockRejectedValueOnce(new Error("no such column: u.is_public"))
        .mockRejectedValueOnce(new Error("no such column: u.is_public"));

      const res = await GET(makeGetRequest("/api/leaderboard"));

      expect(res.status).toBe(500);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it("should fail closed when team_members table is missing", async () => {
      // Both queries fail because team_members table is missing — fail closed
      mockClient.query
        .mockRejectedValueOnce(new Error("no such table: team_members"))
        .mockRejectedValueOnce(new Error("no such table: team_members"));

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "t1" }));

      expect(res.status).toBe(500);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it("should re-throw non-column/table errors", async () => {
      mockClient.query.mockRejectedValueOnce(new Error("connection refused"));

      const res = await GET(makeGetRequest("/api/leaderboard"));

      expect(res.status).toBe(500);
    });

    it("should use nickname when available", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          results: [
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
          ],
        })
        .mockResolvedValueOnce({ results: [] }); // teams query

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].user.name).toBe("alice");
    });

    it("should fall back to name when nickname is null", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          results: [
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
          ],
        })
        .mockResolvedValueOnce({ results: [] }); // teams query

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].user.name).toBe("Bob Jones");
    });

    it("should include fromDate in fallback when period is not all", async () => {
      mockClient.query
        .mockRejectedValueOnce(new Error("no such column: u.nickname"))
        .mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { period: "month" }));

      expect(res.status).toBe(200);
      const fallbackSql = mockClient.query.mock.calls[1]![0] as string;
      expect(fallbackSql).toContain("ur.hour_start >= ?");
    });

    it("should preserve EXISTS filter in level 1 fallback", async () => {
      mockClient.query
        .mockRejectedValueOnce(new Error("no such column: u.nickname"))
        .mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      expect(res.status).toBe(200);
      const fallbackSql = mockClient.query.mock.calls[1]![0] as string;
      expect(fallbackSql).toContain("EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = ur.user_id AND tm.team_id = ?)");
    });
  });

  describe("organization filter", () => {
    it("should add EXISTS filter when org param is provided", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.scope).toBe("org");
      expect(body.scopeId).toBe("org-123");

      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).toContain("EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = ur.user_id AND om.org_id = ?)");
      expect(sqlCall[1]).toContain("org-123");
    });

    it("should return 400 when both org and team are provided", async () => {
      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123", team: "team-abc" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Cannot specify both");
    });

    it("should silently ignore org param for anonymous users", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("global");
      expect(body.scopeId).toBeUndefined();
      // Should NOT have org filter in SQL
      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).not.toContain("organization_members");
    });

    it("should set Cache-Control: private, no-store for anonymous org-scoped request", async () => {
      resolveUser.mockResolvedValueOnce(null); // Anonymous
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(200);
      // Even though data is global, scope param was present so must not be public cached
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("should include is_public filter even when org is set (opt-out respected)", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      const sqlCall = mockClient.query.mock.calls[0]!;
      expect(sqlCall[0]).toContain("u.is_public = 1");
    });

    it("should set Cache-Control: private, no-store for org-scoped leaderboard", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("should fail closed when organization_members table is missing", async () => {
      mockClient.query
        .mockRejectedValueOnce(new Error("no such table: organization_members"))
        .mockRejectedValueOnce(new Error("no such table: organization_members"));

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(500);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it("should preserve EXISTS filter in level 1 fallback for org", async () => {
      mockClient.query
        .mockRejectedValueOnce(new Error("no such column: u.nickname"))
        .mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-123" }));

      expect(res.status).toBe(200);
      const fallbackSql = mockClient.query.mock.calls[1]![0] as string;
      expect(fallbackSql).toContain("EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = ur.user_id AND om.org_id = ?)");
    });
  });

  describe("response shape", () => {
    it("should include scope='global' when no scope params", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("global");
      expect(body.scopeId).toBeUndefined();
    });

    it("should include scope='team' and scopeId when team param is provided", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-xyz" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("team");
      expect(body.scopeId).toBe("team-xyz");
    });

    it("should include scope='org' and scopeId when org param is provided", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { org: "org-abc" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.scope).toBe("org");
      expect(body.scopeId).toBe("org-abc");
    });
  });

  describe("cache headers", () => {
    it("should set cache headers for public leaderboard", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard"));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=120",
      );
    });

    it("should NOT set cache headers for team-scoped leaderboard", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard", { team: "team-abc" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "private, no-store",
      );
    });
  });

  describe("teams in response", () => {
    it("should return empty teams array when teams query fails", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          results: [
            {
              user_id: "u1",
              name: "Alice",
              image: null,
              slug: null,
              total_tokens: 1000,
              input_tokens: 500,
              output_tokens: 400,
              cached_input_tokens: 100,
            },
          ],
        })
        .mockRejectedValueOnce(new Error("no such table: team_members"));

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.entries[0].teams).toEqual([]);
    });

    it("should return empty teams array when no results", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.entries).toEqual([]);
    });

    it("should fetch teams for leaderboard users", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          results: [
            {
              user_id: "u1",
              name: "Alice",
              image: null,
              slug: null,
              total_tokens: 1000,
              input_tokens: 500,
              output_tokens: 400,
              cached_input_tokens: 100,
            },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            { user_id: "u1", team_id: "t1", team_name: "Eng", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/xyz.jpg" },
          ],
        });

      const res = await GET(makeGetRequest("/api/leaderboard"));
      const body = await res.json();

      expect(body.entries[0].teams).toEqual([{ id: "t1", name: "Eng", logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/xyz.jpg" }]);
      // Second query should be the teams lookup
      const teamsSql = mockClient.query.mock.calls[1]![0] as string;
      expect(teamsSql).toContain("team_members");
      expect(teamsSql).toContain("IN (?)");
    });
  });
});

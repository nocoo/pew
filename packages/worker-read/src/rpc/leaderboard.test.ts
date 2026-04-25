import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleLeaderboardRpc,
  type GetUserLeaderboardRequest,
  type GetTeamLeaderboardRequest,
  type GetUserRankRequest,
  type GetTeamRankRequest,
  type GetGlobalLeaderboardRequest,
  type GetUserSessionStatsRequest,
} from "./leaderboard";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Mock D1Database
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
  } as unknown as D1Database & {
    prepare: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Mock KVNamespace
// ---------------------------------------------------------------------------

function createMockKv() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
}

describe("leaderboard RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;
  let kv: ReturnType<typeof createMockKv>;

  beforeEach(() => {
    db = createMockDb();
    kv = createMockKv();
  });

  // -------------------------------------------------------------------------
  // leaderboard.getUsers
  // -------------------------------------------------------------------------

  describe("leaderboard.getUsers", () => {
    it("should return user leaderboard", async () => {
      const mockEntries = [
        { user_id: "u1", name: "alice", image: null, total_tokens: 1000000, rank: 1 },
        { user_id: "u2", name: "bob", image: "https://example.com/bob.png", total_tokens: 800000, rank: 2 },
      ];
      db.all.mockResolvedValue({ results: mockEntries });

      const request: GetUserLeaderboardRequest = {
        method: "leaderboard.getUsers",
        seasonId: "season-1",
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockEntries });
    });

    it("should support pagination", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetUserLeaderboardRequest = {
        method: "leaderboard.getUsers",
        seasonId: "season-1",
        limit: 10,
        offset: 20,
      };
      await handleLeaderboardRpc(request, db, kv);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 400 when seasonId missing", async () => {
      const request = {
        method: "leaderboard.getUsers",
        seasonId: "",
      } as GetUserLeaderboardRequest;
      const response = await handleLeaderboardRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // leaderboard.getTeams
  // -------------------------------------------------------------------------

  describe("leaderboard.getTeams", () => {
    it("should return team leaderboard", async () => {
      const mockEntries = [
        { team_id: "t1", team_name: "Alpha", logo_url: null, total_tokens: 5000000, rank: 1 },
        { team_id: "t2", team_name: "Beta", logo_url: "https://example.com/beta.png", total_tokens: 4000000, rank: 2 },
      ];
      db.all.mockResolvedValue({ results: mockEntries });

      const request: GetTeamLeaderboardRequest = {
        method: "leaderboard.getTeams",
        seasonId: "season-1",
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockEntries });
    });

    it("should support pagination", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetTeamLeaderboardRequest = {
        method: "leaderboard.getTeams",
        seasonId: "season-1",
        limit: 5,
        offset: 10,
      };
      await handleLeaderboardRpc(request, db, kv);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 400 when seasonId missing", async () => {
      const request = {
        method: "leaderboard.getTeams",
        seasonId: "",
      } as GetTeamLeaderboardRequest;
      const response = await handleLeaderboardRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // leaderboard.getUserRank
  // -------------------------------------------------------------------------

  describe("leaderboard.getUserRank", () => {
    it("should return user rank", async () => {
      db.first.mockResolvedValue({ rank: 5, total_tokens: 500000 });

      const request: GetUserRankRequest = {
        method: "leaderboard.getUserRank",
        seasonId: "season-1",
        userId: "u1",
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { rank: 5, total_tokens: 500000 } });
    });

    it("should return null when user not in season", async () => {
      db.first.mockResolvedValue(null);

      const request: GetUserRankRequest = {
        method: "leaderboard.getUserRank",
        seasonId: "season-1",
        userId: "u999",
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "leaderboard.getUserRank",
        seasonId: "",
        userId: "u1",
      } as GetUserRankRequest;
      const response = await handleLeaderboardRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // leaderboard.getTeamRank
  // -------------------------------------------------------------------------

  describe("leaderboard.getTeamRank", () => {
    it("should return team rank", async () => {
      db.first.mockResolvedValue({ rank: 3, total_tokens: 2500000 });

      const request: GetTeamRankRequest = {
        method: "leaderboard.getTeamRank",
        seasonId: "season-1",
        teamId: "t1",
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: { rank: 3, total_tokens: 2500000 } });
    });

    it("should return null when team not in season", async () => {
      db.first.mockResolvedValue(null);

      const request: GetTeamRankRequest = {
        method: "leaderboard.getTeamRank",
        seasonId: "season-1",
        teamId: "t999",
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "leaderboard.getTeamRank",
        seasonId: "season-1",
        teamId: "",
      } as GetTeamRankRequest;
      const response = await handleLeaderboardRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // leaderboard.getGlobal
  // -------------------------------------------------------------------------

  describe("leaderboard.getGlobal", () => {
    const mockRows = [
      { user_id: "u1", name: "alice", nickname: null, image: null, slug: "alice", total_tokens: 1000000, input_tokens: 600000, output_tokens: 400000, cached_input_tokens: 50000 },
    ];

    it("should cache public (non-scoped) leaderboard requests", async () => {
      db.all.mockResolvedValue({ results: mockRows });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        limit: 20,
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockRows, _cached: false });
      expect(kv.get).toHaveBeenCalledWith("lb:global::::20:0", "json");
      expect(kv.put).toHaveBeenCalledWith(
        "lb:global::::20:0",
        JSON.stringify(mockRows),
        { expirationTtl: 300 }
      );
    });

    it("should return cached data on cache hit", async () => {
      kv.get.mockResolvedValue(mockRows);

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        limit: 20,
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockRows, _cached: true });
      expect(db.all).not.toHaveBeenCalled();
    });

    it("should NOT cache requests with teamId (private scope)", async () => {
      db.all.mockResolvedValue({ results: mockRows });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        teamId: "team-123",
        limit: 20,
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockRows, _cached: false });
      expect(kv.get).not.toHaveBeenCalled();
      expect(kv.put).not.toHaveBeenCalled();
    });

    it("should NOT cache requests with orgId (private scope)", async () => {
      db.all.mockResolvedValue({ results: mockRows });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        orgId: "org-456",
        limit: 20,
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockRows, _cached: false });
      expect(kv.get).not.toHaveBeenCalled();
      expect(kv.put).not.toHaveBeenCalled();
    });

    it("should include source filter in cache key", async () => {
      db.all.mockResolvedValue({ results: mockRows });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        source: "claude-code",
        limit: 20,
      };
      await handleLeaderboardRpc(request, db, kv);

      expect(kv.get).toHaveBeenCalledWith("lb:global::claude-code::20:0", "json");
      // source param should be bound before limit and offset
      expect(db.bind).toHaveBeenCalledWith("claude-code", 20, 0);
      // SQL should contain source filter
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("ur.source = ?");
    });

    it("should include model filter in cache key", async () => {
      db.all.mockResolvedValue({ results: mockRows });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        model: "claude-sonnet-4-20250514",
        limit: 20,
      };
      await handleLeaderboardRpc(request, db, kv);

      expect(kv.get).toHaveBeenCalledWith("lb:global:::claude-sonnet-4-20250514:20:0", "json");
    });

    it("should combine fromDate, source, model in cache key", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        fromDate: "2026-01-01T00:00:00.000Z",
        source: "codex",
        model: "o3",
        limit: 10,
        offset: 5,
      };
      await handleLeaderboardRpc(request, db, kv);

      expect(kv.get).toHaveBeenCalledWith(
        "lb:global:2026-01-01T00:00:00.000Z:codex:o3:10:5",
        "json"
      );
    });

    it("should fall back to query without nickname on column error", async () => {
      db.all
        .mockRejectedValueOnce(new Error("no such column: u.nickname"))
        .mockResolvedValueOnce({ results: mockRows });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        limit: 20,
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockRows, _cached: false });
      // Should have been called twice (first with nickname, then without)
      expect(db.prepare).toHaveBeenCalledTimes(2);
    });

    it("should rethrow non-schema errors (no fallback)", async () => {
      db.all.mockRejectedValueOnce(new Error("connection refused"));

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        limit: 20,
      };
      await expect(handleLeaderboardRpc(request, db, kv)).rejects.toThrow(
        "connection refused",
      );
      // Only the first prepare attempt should have been made (no fallback retry)
      expect(db.prepare).toHaveBeenCalledTimes(1);
    });

    it("should treat a non-Error throwable as a non-schema error and rethrow", async () => {
      db.all.mockRejectedValueOnce("not an Error instance");

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        limit: 20,
      };
      await expect(handleLeaderboardRpc(request, db, kv)).rejects.toBeDefined();
      expect(db.prepare).toHaveBeenCalledTimes(1);
    });

    it("should fall back when error message includes 'no such table'", async () => {
      db.all
        .mockRejectedValueOnce(new Error("no such table: users"))
        .mockResolvedValueOnce({ results: mockRows });

      const request: GetGlobalLeaderboardRequest = {
        method: "leaderboard.getGlobal",
        limit: 20,
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockRows, _cached: false });
      expect(db.prepare).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // leaderboard.getUserTeams
  // -------------------------------------------------------------------------

  describe("leaderboard.getUserTeams", () => {
    it("should return team memberships for given userIds", async () => {
      const rows = [
        { user_id: "u1", team_id: "t1", team_name: "Acme", logo_url: null },
        { user_id: "u2", team_id: "t2", team_name: "Globex", logo_url: "https://x/y.png" },
      ];
      db.all.mockResolvedValue({ results: rows });

      const response = await handleLeaderboardRpc(
        { method: "leaderboard.getUserTeams", userIds: ["u1", "u2"] } as never,
        db,
        kv,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { result: typeof rows };
      expect(body.result).toEqual(rows);
      expect(db.bind).toHaveBeenCalledWith("u1", "u2");
    });

    it("should return empty array when userIds is empty", async () => {
      const response = await handleLeaderboardRpc(
        { method: "leaderboard.getUserTeams", userIds: [] } as never,
        db,
        kv,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: [] });
      expect(db.prepare).not.toHaveBeenCalled();
    });

    it("should return empty array when userIds is undefined", async () => {
      const response = await handleLeaderboardRpc(
        { method: "leaderboard.getUserTeams" } as never,
        db,
        kv,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: [] });
      expect(db.prepare).not.toHaveBeenCalled();
    });

    it("should silently return empty when tables do not exist", async () => {
      db.all.mockRejectedValueOnce(new Error("no such table: team_members"));
      const response = await handleLeaderboardRpc(
        { method: "leaderboard.getUserTeams", userIds: ["u1"] } as never,
        db,
        kv,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: [] });
    });
  });

  // -------------------------------------------------------------------------
  // leaderboard.getUserSessionStats
  // -------------------------------------------------------------------------

  describe("leaderboard.getUserSessionStats", () => {
    it("should return session stats for user IDs", async () => {
      const mockStats = [
        { user_id: "u1", session_count: 42, total_duration_seconds: 3600 },
      ];
      db.all.mockResolvedValue({ results: mockStats });

      const request: GetUserSessionStatsRequest = {
        method: "leaderboard.getUserSessionStats",
        userIds: ["u1"],
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockStats });
      expect(db.bind).toHaveBeenCalledWith("u1");
    });

    it("should return empty array for empty userIds", async () => {
      const request: GetUserSessionStatsRequest = {
        method: "leaderboard.getUserSessionStats",
        userIds: [],
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: [] });
      // Should not call prepare — early return
      expect(db.prepare).not.toHaveBeenCalled();
    });

    it("should include fromDate filter when provided", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetUserSessionStatsRequest = {
        method: "leaderboard.getUserSessionStats",
        userIds: ["u1", "u2"],
        fromDate: "2026-03-01T00:00:00.000Z",
      };
      await handleLeaderboardRpc(request, db, kv);

      expect(db.bind).toHaveBeenCalledWith("u1", "u2", "2026-03-01T00:00:00.000Z");
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("sr.started_at >= ?");
    });

    it("should include source filter when provided", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetUserSessionStatsRequest = {
        method: "leaderboard.getUserSessionStats",
        userIds: ["u1"],
        source: "claude-code",
      };
      await handleLeaderboardRpc(request, db, kv);

      expect(db.bind).toHaveBeenCalledWith("u1", "claude-code");
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("sr.source = ?");
    });

    it("should combine fromDate and source filters", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetUserSessionStatsRequest = {
        method: "leaderboard.getUserSessionStats",
        userIds: ["u1"],
        fromDate: "2026-01-01T00:00:00.000Z",
        source: "gemini-cli",
      };
      await handleLeaderboardRpc(request, db, kv);

      // Params order: userIds, fromDate, source
      expect(db.bind).toHaveBeenCalledWith("u1", "2026-01-01T00:00:00.000Z", "gemini-cli");
      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("sr.started_at >= ?");
      expect(sql).toContain("sr.source = ?");
    });

    it("should return empty on table-not-found error", async () => {
      db.all.mockRejectedValueOnce(new Error("no such table: session_records"));

      const request: GetUserSessionStatsRequest = {
        method: "leaderboard.getUserSessionStats",
        userIds: ["u1"],
      };
      const response = await handleLeaderboardRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: [] });
    });

    it("should rethrow non-schema errors", async () => {
      db.all.mockRejectedValueOnce(new Error("connection refused"));
      await expect(
        handleLeaderboardRpc(
          { method: "leaderboard.getUserSessionStats", userIds: ["u1"] } as never,
          db,
          kv,
        ),
      ).rejects.toThrow("connection refused");
    });

    it("should rethrow non-Error throwables (not a 'no such table' string)", async () => {
      db.all.mockRejectedValueOnce("opaque failure");
      await expect(
        handleLeaderboardRpc(
          { method: "leaderboard.getUserSessionStats", userIds: ["u1"] } as never,
          db,
          kv,
        ),
      ).rejects.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "leaderboard.unknown" } as unknown as GetUserLeaderboardRequest;
      const response = await handleLeaderboardRpc(request, db, kv);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown leaderboard method");
    });
  });
});

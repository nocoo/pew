import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleLeaderboardRpc,
  type GetUserLeaderboardRequest,
  type GetTeamLeaderboardRequest,
  type GetUserRankRequest,
  type GetTeamRankRequest,
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
        {
          user_id: "u2",
          name: "bob",
          image: "https://example.com/bob.png",
          total_tokens: 800000,
          rank: 2,
        },
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
        {
          team_id: "t2",
          team_name: "Beta",
          logo_url: "https://example.com/beta.png",
          total_tokens: 4000000,
          rank: 2,
        },
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

  it("returns the current authoritative revision", async () => {
    db.first.mockResolvedValue({ revision: "a".repeat(32) });
    const res = await handleLeaderboardRpc({ method: "leaderboard.getRevision" }, db, kv);
    expect(await res.json()).toEqual({ result: "a".repeat(32) });
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

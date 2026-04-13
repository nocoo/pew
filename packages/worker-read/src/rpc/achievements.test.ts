import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleAchievementsRpc,
  type GetUsageAggregatesRequest,
  type GetDailyUsageRequest,
  type GetDailyCostBreakdownRequest,
  type GetDiversityCountsRequest,
  type GetSessionAggregatesRequest,
  type GetHourlyUsageRequest,
  type GetCostByModelSourceRequest,
  type GetAchievementEarnersRequest,
  type GetAchievementEarnersCountRequest,
} from "./achievements";
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

function createMockKV() {
  return {
    get: vi.fn().mockResolvedValue(null), // Cache miss by default
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
  } as unknown as KVNamespace & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
}

describe("achievements RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    db = createMockDb();
    kv = createMockKV();
  });

  // -------------------------------------------------------------------------
  // achievements.getUsageAggregates
  // -------------------------------------------------------------------------

  describe("achievements.getUsageAggregates", () => {
    it("should return usage aggregates", async () => {
      const mockAggregates = {
        total_tokens: 1000000,
        input_tokens: 600000,
        output_tokens: 400000,
        cached_input_tokens: 100000,
        reasoning_output_tokens: 50000,
      };
      db.first.mockResolvedValue(mockAggregates);

      const request: GetUsageAggregatesRequest = {
        method: "achievements.getUsageAggregates",
        userId: "u1",
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockAggregates });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "achievements.getUsageAggregates",
        userId: "",
      } as GetUsageAggregatesRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getDailyUsage
  // -------------------------------------------------------------------------

  describe("achievements.getDailyUsage", () => {
    it("should return daily usage", async () => {
      const mockDaily = [
        { day: "2026-04-01", total_tokens: 50000 },
        { day: "2026-04-02", total_tokens: 30000 },
      ];
      db.all.mockResolvedValue({ results: mockDaily });

      const request: GetDailyUsageRequest = {
        method: "achievements.getDailyUsage",
        userId: "u1",
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockDaily });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "achievements.getDailyUsage",
        userId: "",
      } as GetDailyUsageRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getDailyCostBreakdown
  // -------------------------------------------------------------------------

  describe("achievements.getDailyCostBreakdown", () => {
    it("should return daily cost breakdown", async () => {
      const mockCost = [
        {
          day: "2026-04-01",
          model: "claude-sonnet-4",
          source: "claude-code",
          input_tokens: 30000,
          output_tokens: 20000,
          cached_input_tokens: 5000,
        },
      ];
      db.all.mockResolvedValue({ results: mockCost });

      const request: GetDailyCostBreakdownRequest = {
        method: "achievements.getDailyCostBreakdown",
        userId: "u1",
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockCost });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "achievements.getDailyCostBreakdown",
        userId: "",
      } as GetDailyCostBreakdownRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getDiversityCounts
  // -------------------------------------------------------------------------

  describe("achievements.getDiversityCounts", () => {
    it("should return diversity counts", async () => {
      const mockDiversity = {
        source_count: 5,
        model_count: 10,
        device_count: 3,
      };
      db.first.mockResolvedValue(mockDiversity);

      const request: GetDiversityCountsRequest = {
        method: "achievements.getDiversityCounts",
        userId: "u1",
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockDiversity });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "achievements.getDiversityCounts",
        userId: "",
      } as GetDiversityCountsRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getSessionAggregates
  // -------------------------------------------------------------------------

  describe("achievements.getSessionAggregates", () => {
    it("should return session aggregates", async () => {
      const mockSession = {
        total_sessions: 100,
        quick_sessions: 20,
        marathon_sessions: 5,
        max_messages: 150,
        automated_sessions: 10,
      };
      db.first.mockResolvedValue(mockSession);

      const request: GetSessionAggregatesRequest = {
        method: "achievements.getSessionAggregates",
        userId: "u1",
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockSession });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "achievements.getSessionAggregates",
        userId: "",
      } as GetSessionAggregatesRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getHourlyUsage
  // -------------------------------------------------------------------------

  describe("achievements.getHourlyUsage", () => {
    it("should return hourly usage", async () => {
      const mockHourly = [
        { hour_start: "2026-04-01T10:00:00.000Z", total_tokens: 5000 },
        { hour_start: "2026-04-01T11:00:00.000Z", total_tokens: 3000 },
      ];
      db.all.mockResolvedValue({ results: mockHourly });

      const request: GetHourlyUsageRequest = {
        method: "achievements.getHourlyUsage",
        userId: "u1",
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockHourly });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "achievements.getHourlyUsage",
        userId: "",
      } as GetHourlyUsageRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getCostByModelSource
  // -------------------------------------------------------------------------

  describe("achievements.getCostByModelSource", () => {
    it("should return cost breakdown by model and source", async () => {
      const mockCost = [
        {
          model: "claude-sonnet-4",
          source: "claude-code",
          input_tokens: 300000,
          output_tokens: 200000,
          cached_input_tokens: 50000,
        },
      ];
      db.all.mockResolvedValue({ results: mockCost });

      const request: GetCostByModelSourceRequest = {
        method: "achievements.getCostByModelSource",
        userId: "u1",
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockCost });
    });

    it("should return 400 when userId missing", async () => {
      const request = {
        method: "achievements.getCostByModelSource",
        userId: "",
      } as GetCostByModelSourceRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getEarners
  // -------------------------------------------------------------------------

  describe("achievements.getEarners", () => {
    it("should return achievement earners", async () => {
      const mockEarners = [
        { id: "u1", name: "User 1", image: null, slug: "user-1", value: 1000000, earned_at: "2026-01-01T00:00:00.000Z" },
        { id: "u2", name: "User 2", image: null, slug: "user-2", value: 500000, earned_at: null },
      ];
      db.all.mockResolvedValue({ results: mockEarners });

      const request: GetAchievementEarnersRequest = {
        method: "achievements.getEarners",
        achievementId: "power-user",
        sql: "SELECT id, name, image, slug, value, earned_at FROM users WHERE value >= ? LIMIT ? OFFSET ?",
        params: [100000, 5, 0],
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockEarners, _cached: false });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "achievements.getEarners",
        achievementId: "",
        sql: "SELECT ...",
        params: [100000, 5, 0],
      } as GetAchievementEarnersRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // achievements.getEarnersCount
  // -------------------------------------------------------------------------

  describe("achievements.getEarnersCount", () => {
    it("should return achievement earners count", async () => {
      db.first.mockResolvedValue({ count: 42 });

      const request: GetAchievementEarnersCountRequest = {
        method: "achievements.getEarnersCount",
        achievementId: "power-user",
        sql: "SELECT COUNT(*) AS count FROM users WHERE value >= ?",
        params: [100000],
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 42, _cached: false });
    });

    it("should return 0 when no result", async () => {
      db.first.mockResolvedValue(null);

      const request: GetAchievementEarnersCountRequest = {
        method: "achievements.getEarnersCount",
        achievementId: "power-user",
        sql: "SELECT COUNT(*) AS count FROM users WHERE value >= ?",
        params: [100000],
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 0, _cached: false });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "achievements.getEarnersCount",
        achievementId: "power-user",
        sql: "",
        params: [100000],
      } as GetAchievementEarnersCountRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
    });

    it("should return cached count on cache hit", async () => {
      kv.get.mockResolvedValue(42); // Cache hit

      const request: GetAchievementEarnersCountRequest = {
        method: "achievements.getEarnersCount",
        achievementId: "power-user",
        sql: "SELECT COUNT(*) AS count FROM users WHERE value >= ?",
        params: [100000],
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: 42, _cached: true });
      // Should NOT call DB on cache hit
      expect(db.prepare).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cache behavior for getEarners
  // -------------------------------------------------------------------------

  describe("achievements.getEarners cache", () => {
    it("should return cached earners on cache hit", async () => {
      const cachedEarners = [
        { id: "u1", name: "Cached User", image: null, slug: "cached", value: 999, earned_at: null },
      ];
      kv.get.mockResolvedValue(cachedEarners); // Cache hit

      const request: GetAchievementEarnersRequest = {
        method: "achievements.getEarners",
        achievementId: "power-user",
        sql: "SELECT id, name, image, slug, value, earned_at FROM users WHERE value >= ? LIMIT ? OFFSET ?",
        params: [100000, 5, 0],
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: cachedEarners, _cached: true });
      // Should NOT call DB on cache hit
      expect(db.prepare).not.toHaveBeenCalled();
    });

    it("should write to cache on cache miss", async () => {
      const mockEarners = [
        { id: "u1", name: "User 1", image: null, slug: "user-1", value: 1000000, earned_at: null },
      ];
      kv.get.mockResolvedValue(null); // Cache miss
      db.all.mockResolvedValue({ results: mockEarners });

      const request: GetAchievementEarnersRequest = {
        method: "achievements.getEarners",
        achievementId: "power-user",
        sql: "SELECT id, name, image, slug, value, earned_at FROM users WHERE value >= ? LIMIT ? OFFSET ?",
        params: [100000, 5, 0],
      };
      const response = await handleAchievementsRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockEarners, _cached: false });
      // Should write to cache
      expect(kv.put).toHaveBeenCalledWith(
        "ach:power-user:earners:5:0",
        JSON.stringify(mockEarners),
        { expirationTtl: 300 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "achievements.unknown" } as unknown as GetUsageAggregatesRequest;
      const response = await handleAchievementsRpc(request, db, kv);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown achievements method");
    });
  });
});

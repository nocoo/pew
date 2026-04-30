import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/users/[slug]/achievements/route";
import * as dbModule from "@/lib/db";
import { createMockClient, makeGetRequest } from "./test-utils";

// Mock DB
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

describe("GET /api/users/[slug]/achievements", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockClient as any);
  });

  describe("user lookup", () => {
    it("should return 404 for non-existent user", async () => {
      mockClient.getPublicUserBySlugOrId.mockResolvedValueOnce(null);

      const res = await GET(
        makeGetRequest("/api/users/unknown/achievements"),
        { params: Promise.resolve({ slug: "unknown" }) }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("User not found");
    });

    it("should return 404 for non-public user", async () => {
      // User lookup returns null because is_public = 0 in WHERE clause
      mockClient.getPublicUserBySlugOrId.mockResolvedValueOnce(null);

      const res = await GET(
        makeGetRequest("/api/users/private-user/achievements"),
        { params: Promise.resolve({ slug: "private-user" }) }
      );

      expect(res.status).toBe(404);
    });
  });

  describe("response structure", () => {
    beforeEach(() => {
      // User lookup
      mockClient.getPublicUserBySlugOrId.mockResolvedValue({
        id: "u1",
        name: "Test User",
        nickname: null,
        image: null,
        slug: "test-user",
        created_at: "2026-01-01T00:00:00Z",
        is_public: 1,
      });

      // Usage aggregates
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 5_000_000_000, // 5B tokens
        input_tokens: 3_000_000_000,
        output_tokens: 2_000_000_000,
        cached_input_tokens: 1_000_000_000,
        reasoning_output_tokens: 100_000_000,
      });

      // Daily usage
      mockClient.getAchievementDailyUsage.mockResolvedValue([
        { day: "2026-04-01", total_tokens: 100_000_000 },
        { day: "2026-04-02", total_tokens: 500_000_000 },
        { day: "2026-04-03", total_tokens: 200_000_000 },
      ]);

      // Cost by model/source/day
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([
        {
          day: "2026-04-02",
          model: "claude-sonnet-4-20250514",
          source: "claude-code",
          input_tokens: 300_000_000,
          output_tokens: 200_000_000,
          cached_input_tokens: 100_000_000,
        },
      ]);

      // Diversity
      mockClient.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 4,
        model_count: 8,
        device_count: 3,
      });

      // Session aggregates
      mockClient.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 500,
        quick_sessions: 200,
        marathon_sessions: 30,
        max_messages: 250,
        automated_sessions: 50,
      });

      // Cost by model/source (total)
      mockClient.getAchievementCostByModelSource.mockResolvedValue([
        {
          model: "claude-sonnet-4-20250514",
          source: "claude-code",
          input_tokens: 3_000_000_000,
          output_tokens: 2_000_000_000,
          cached_input_tokens: 1_000_000_000,
        },
      ]);
    });

    it("should return achievements and summary", async () => {
      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      // Should have achievements array
      expect(Array.isArray(body.achievements)).toBe(true);
      expect(body.achievements.length).toBeLessThanOrEqual(6); // Top 6 only

      // Should have summary with concrete numeric invariants
      expect(body.summary).toMatchObject({
        totalUnlocked: expect.any(Number),
        totalAchievements: expect.any(Number),
        diamondCount: expect.any(Number),
        currentStreak: expect.any(Number),
      });
      expect(body.summary.diamondCount).toBeLessThanOrEqual(body.summary.totalUnlocked);
      expect(body.summary.totalUnlocked).toBeLessThanOrEqual(body.summary.totalAchievements);
      expect(body.summary.currentStreak).toBeGreaterThanOrEqual(0);
      expect(body.summary.totalAchievements).toBeGreaterThan(0);
    });

    it("should return achievement fields correctly", async () => {
      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      const body = await res.json();
      const ach = body.achievements[0];

      // Strong shape & domain checks (not just presence)
      expect(typeof ach.id).toBe("string");
      expect(ach.id.length).toBeGreaterThan(0);
      expect(typeof ach.name).toBe("string");
      expect(ach.name.length).toBeGreaterThan(0);
      expect(typeof ach.flavorText).toBe("string");
      expect(typeof ach.icon).toBe("string");
      expect(["volume", "consistency", "efficiency", "spending", "diversity", "sessions", "special"]).toContain(
        ach.category,
      );
      expect(["locked", "bronze", "silver", "gold", "diamond"]).toContain(ach.tier);
      expect(typeof ach.currentValue).toBe("number");
      expect(ach.tiers).toHaveLength(4);
      for (let i = 1; i < ach.tiers.length; i++) {
        expect(ach.tiers[i]).toBeGreaterThan(ach.tiers[i - 1]);
      }
      expect(typeof ach.progress).toBe("number");
      expect(ach.progress).toBeGreaterThanOrEqual(0);
      expect(ach.progress).toBeLessThanOrEqual(1);
      expect(typeof ach.displayValue).toBe("string");
      expect(typeof ach.displayThreshold).toBe("string");
      expect(typeof ach.unit).toBe("string");
    });

    it("should sort achievements by tier rank and progress", async () => {
      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      const body = await res.json();
      const achievements = body.achievements;

      // Verify sorting: higher tier first, then higher progress
      const tierRank = { locked: 0, bronze: 1, silver: 2, gold: 3, diamond: 4 };
      for (let i = 0; i < achievements.length - 1; i++) {
        const current = achievements[i];
        const next = achievements[i + 1];
        const currentRank = tierRank[current.tier as keyof typeof tierRank];
        const nextRank = tierRank[next.tier as keyof typeof tierRank];

        // Either current tier is higher, or same tier with higher/equal progress
        expect(currentRank >= nextRank).toBe(true);
        if (currentRank === nextRank) {
          expect(current.progress >= next.progress).toBe(true);
        }
      }
    });

    it("should exclude timezone-dependent achievements", async () => {
      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      const body = await res.json();
      const ids = body.achievements.map((a: any) => a.id);

      expect(ids).not.toContain("weekend-warrior");
      expect(ids).not.toContain("night-owl");
      expect(ids).not.toContain("early-bird");
    });
  });

  describe("error handling", () => {
    it("should return 500 on database error", async () => {
      mockClient.getPublicUserBySlugOrId.mockRejectedValueOnce(new Error("DB connection failed"));

      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to compute achievements");
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      // User lookup
      mockClient.getPublicUserBySlugOrId.mockResolvedValue({
        id: "u1",
        name: "Test User",
        nickname: null,
        image: null,
        slug: "test-user",
        created_at: "2026-01-01T00:00:00Z",
        is_public: 1,
      });
    });

    it("should handle null usage aggregates gracefully", async () => {
      mockClient.getAchievementUsageAggregates.mockResolvedValue(null);
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue(null);
      mockClient.getAchievementSessionAggregates.mockResolvedValue(null);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);

      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.achievements).toBeDefined();
      expect(body.summary.currentStreak).toBe(0);
    });

    it("should handle zero input tokens for cache ratio", async () => {
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        reasoning_output_tokens: 0,
      });
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 0,
        model_count: 0,
        device_count: 0,
      });
      mockClient.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 0,
        quick_sessions: 0,
        marathon_sessions: 0,
        max_messages: 0,
        automated_sessions: 0,
      });
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);

      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      expect(res.status).toBe(200);
    });

    it("should compute cost without cached pricing when not available", async () => {
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 1_000_000,
        input_tokens: 500_000,
        output_tokens: 500_000,
        cached_input_tokens: 0, // No cached tokens
        reasoning_output_tokens: 0,
      });
      mockClient.getAchievementDailyUsage.mockResolvedValue([
        { day: "2026-04-01", total_tokens: 1_000_000 },
      ]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([
        {
          day: "2026-04-01",
          model: "unknown-model", // Unknown model to trigger fallback pricing
          source: null,
          input_tokens: 500_000,
          output_tokens: 500_000,
          cached_input_tokens: 0,
        },
      ]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 1,
        model_count: 1,
        device_count: 1,
      });
      mockClient.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 1,
        quick_sessions: 0,
        marathon_sessions: 0,
        max_messages: 10,
        automated_sessions: 0,
      });
      mockClient.getAchievementCostByModelSource.mockResolvedValue([
        {
          model: "unknown-model",
          source: null,
          input_tokens: 500_000,
          output_tokens: 500_000,
          cached_input_tokens: 0,
        },
      ]);

      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      expect(res.status).toBe(200);
    });

    it("does not double-count cached tokens against input price (big-spender)", async () => {
      // Regression mirror of /api/achievements equivalent — both routes share canonical estimateCost.
      const SENTINEL_MODEL = "double-count-sentinel-public";
      mockClient.getDynamicPricing.mockResolvedValue({
        entries: [
          {
            model: SENTINEL_MODEL,
            provider: null,
            displayName: null,
            inputPerMillion: 10,
            outputPerMillion: 10,
            cachedPerMillion: 1,
            contextWindow: null,
            origin: "baseline",
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        ],
        servedFrom: "kv",
      });

      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 1_000_000, input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 1_000_000, reasoning_output_tokens: 0,
      });
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([
        { day: "2026-04-03", model: SENTINEL_MODEL, source: null, input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 1_000_000 },
      ]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue({ source_count: 0, model_count: 0, device_count: 0 });
      mockClient.getAchievementSessionAggregates.mockResolvedValue({ total_sessions: 0, quick_sessions: 0, marathon_sessions: 0, max_messages: 0, automated_sessions: 0 });
      mockClient.getAchievementCostByModelSource.mockResolvedValue([
        { model: SENTINEL_MODEL, source: null, input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 1_000_000 },
      ]);

      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const bigSpender = body.achievements.find((a: { id: string }) => a.id === "big-spender");
      // Canonical: input cost = (1M − 1M)/1M × 10 = 0; cached = 1M/1M × 1 = 1 → $1.
      // Old buggy: 1M × 10/1M + 1M × 1/1M = $11.
      expect(bigSpender?.currentValue).toBeCloseTo(1, 5);
    });

    it("falls back to input × 0.1 when dynamic pricing has no cached price", async () => {
      const SENTINEL_MODEL = "cached-fallback-sentinel-public";
      mockClient.getDynamicPricing.mockResolvedValue({
        entries: [
          {
            model: SENTINEL_MODEL,
            provider: null,
            displayName: null,
            inputPerMillion: 10,
            outputPerMillion: 10,
            cachedPerMillion: null,
            contextWindow: null,
            origin: "baseline",
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        ],
        servedFrom: "kv",
      });

      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 1_000_000, input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 1_000_000, reasoning_output_tokens: 0,
      });
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([
        { day: "2026-04-03", model: SENTINEL_MODEL, source: null, input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 1_000_000 },
      ]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue({ source_count: 0, model_count: 0, device_count: 0 });
      mockClient.getAchievementSessionAggregates.mockResolvedValue({ total_sessions: 0, quick_sessions: 0, marathon_sessions: 0, max_messages: 0, automated_sessions: 0 });
      mockClient.getAchievementCostByModelSource.mockResolvedValue([
        { model: SENTINEL_MODEL, source: null, input_tokens: 1_000_000, output_tokens: 0, cached_input_tokens: 1_000_000 },
      ]);

      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const bigSpender = body.achievements.find((a: { id: string }) => a.id === "big-spender");
      // Canonical fallback: cached = input × 0.1 → 1M/1M × 1 = $1. Old buggy: $0.
      expect(bigSpender?.currentValue).toBeCloseTo(1, 5);
    });
  });
});

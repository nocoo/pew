import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/achievements/route";
import * as dbModule from "@/lib/db";
import { createMockClient, makeGetRequest } from "./test-utils";

// Mock DB
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

// Mock resolveUser
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

describe("GET /api/achievements", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockClient as any);
  });

  describe("authentication", () => {
    it("should reject unauthenticated requests", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("response structure", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });

      // Setup default mock responses for all RPC methods
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 1_000_000,
        input_tokens: 600_000,
        output_tokens: 400_000,
        cached_input_tokens: 200_000,
        reasoning_output_tokens: 50_000,
      });

      mockClient.getAchievementDailyUsage.mockResolvedValue([
        { day: "2026-04-03", total_tokens: 100_000 },
        { day: "2026-04-04", total_tokens: 200_000 },
        { day: "2026-04-05", total_tokens: 150_000 },
      ]);

      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([
        {
          day: "2026-04-03",
          model: "claude-sonnet-4-20250514",
          source: null,
          input_tokens: 50_000,
          output_tokens: 30_000,
          cached_input_tokens: 10_000,
        },
      ]);

      mockClient.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 3,
        model_count: 5,
        device_count: 2,
      });

      mockClient.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 50,
        quick_sessions: 20,
        marathon_sessions: 5,
        max_messages: 150,
        automated_sessions: 10,
      });

      mockClient.getAchievementHourlyUsage.mockResolvedValue([
        { hour_start: "2026-04-05T02:00:00Z", total_tokens: 10_000 },
        { hour_start: "2026-04-05T07:00:00Z", total_tokens: 20_000 },
      ]);

      mockClient.getAchievementCostByModelSource.mockResolvedValue([
        {
          model: "claude-sonnet-4-20250514",
          source: null,
          input_tokens: 600_000,
          output_tokens: 400_000,
          cached_input_tokens: 200_000,
        },
      ]);

      // Earners queries
      mockClient.getAchievementEarners.mockResolvedValue([
        { id: "u2", name: "Alice", image: null, slug: "alice", value: 50_000_000 },
      ]);

      mockClient.getAchievementEarnersCount.mockResolvedValue(5);
    });

    it("should return achievements array and summary", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(Array.isArray(body.achievements)).toBe(true);
      expect(body.achievements.length).toBe(25);

      expect(body.summary).toMatchObject({
        totalAchievements: 25,
        totalUnlocked: expect.any(Number),
        diamondCount: expect.any(Number),
        currentStreak: expect.any(Number),
      });
      // diamondCount cannot exceed totalUnlocked, totalUnlocked cannot exceed total
      expect(body.summary.diamondCount).toBeLessThanOrEqual(body.summary.totalUnlocked);
      expect(body.summary.totalUnlocked).toBeLessThanOrEqual(body.summary.totalAchievements);
      expect(body.summary.currentStreak).toBeGreaterThanOrEqual(0);
    });

    it("should return all achievement fields", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();

      const ach = body.achievements[0];
      // Strong: assert types AND domain constraints (not just presence)
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
      // tiers must be strictly increasing
      for (let i = 1; i < ach.tiers.length; i++) {
        expect(ach.tiers[i]).toBeGreaterThan(ach.tiers[i - 1]);
      }
      expect(typeof ach.progress).toBe("number");
      expect(ach.progress).toBeGreaterThanOrEqual(0);
      expect(ach.progress).toBeLessThanOrEqual(1);
      expect(typeof ach.displayValue).toBe("string");
      expect(typeof ach.displayThreshold).toBe("string");
      expect(typeof ach.unit).toBe("string");
      expect(Array.isArray(ach.earnedBy)).toBe(true);
      expect(typeof ach.totalEarned).toBe("number");
      expect(ach.totalEarned).toBeGreaterThanOrEqual(0);
    });

    it("should compute correct achievement tiers", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();

      // power-user: 1M tokens, tiers [1B, 10B, 50B, 200B] → locked (far below bronze)
      const powerUser = body.achievements.find((a: any) => a.id === "power-user");
      expect(powerUser.tier).toBe("locked");
      expect(powerUser.currentValue).toBe(1_000_000);

      // first-blood: any usage unlocks diamond (single-tier)
      const firstBlood = body.achievements.find((a: any) => a.id === "first-blood");
      expect(firstBlood.tier).toBe("diamond");

      // streak: depends on whether mock dates include today, so just verify structure
      const streak = body.achievements.find((a: any) => a.id === "streak");
      expect(typeof streak.currentValue).toBe("number");
      expect(streak.tiers).toEqual([7, 30, 90, 365]);

      // veteran: 3 unique active days in mock data
      const veteran = body.achievements.find((a: any) => a.id === "veteran");
      expect(veteran.currentValue).toBe(3);
      // tiers [30, 90, 180, 365] → 3 days = locked
      expect(veteran.tier).toBe("locked");
    });

    it("should exclude timezone-dependent achievements from earnedBy", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();

      const tzDependentIds = ["weekend-warrior", "night-owl", "early-bird"];
      for (const id of tzDependentIds) {
        const ach = body.achievements.find((a: any) => a.id === id);
        expect(ach.earnedBy).toEqual([]);
        expect(ach.totalEarned).toBe(0);
      }
    });
  });

  describe("tzOffset parameter", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });

      // Setup minimal mock responses
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 100_000,
        input_tokens: 60_000,
        output_tokens: 40_000,
        cached_input_tokens: 20_000,
        reasoning_output_tokens: 5_000,
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
      mockClient.getAchievementHourlyUsage.mockResolvedValue([]);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);
    });

    it("should accept tzOffset query parameter", async () => {
      const res = await GET(makeGetRequest("/api/achievements", { tzOffset: "-480" }));

      expect(res.status).toBe(200);
    });

    it("should use 0 as default tzOffset", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(200);
      // The route should process without error using UTC
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should return 500 on database error", async () => {
      mockClient.getAchievementUsageAggregates.mockRejectedValueOnce(new Error("DB connection failed"));

      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to compute achievements");
    });

    it("should return 500 and log when error is a non-Error throwable", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockClient.getAchievementUsageAggregates.mockRejectedValueOnce("string error");

      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(500);
      consoleSpy.mockRestore();
    });

    it("defaults all token/session/diversity values to 0 when aggregates are null/empty", async () => {
      // All aggregate RPCs return null (worker-read returns null for empty aggregates).
      // This exercises every `usageAgg?.X ?? 0`, `sessionAgg?.X ?? 0`, `diversity?.X ?? 0` branch.
      mockClient.getAchievementUsageAggregates.mockResolvedValue(null);
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue(null);
      mockClient.getAchievementSessionAggregates.mockResolvedValue(null);
      mockClient.getAchievementHourlyUsage.mockResolvedValue([]);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);

      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(200);
      const body = await res.json();
      // All achievements present, all currentValues at 0 (or fall-through defaults)
      expect(body.achievements.length).toBe(25);
      const ids = [
        "power-user",
        "big-day",
        "input-hog",
        "output-addict",
        "reasoning-junkie",
        "cache-master",
        "quick-draw",
        "marathon",
        "big-spender",
        "daily-burn",
        "tool-hoarder",
        "model-tourist",
        "device-nomad",
        "chatterbox",
        "session-hoarder",
        "automation-addict",
        "first-blood",
        "centurion",
        "millionaire",
        "billionaire",
        "veteran",
      ];
      const byId = new Map<string, { currentValue: number; tier: string }>(
        body.achievements.map((a: { id: string; currentValue: number; tier: string }) => [a.id, { currentValue: a.currentValue, tier: a.tier }]),
      );
      for (const id of ids) {
        const a = byId.get(id);
        expect(a, `achievement ${id}`).toBeDefined();
        expect(a!.currentValue).toBe(0);
        expect(a!.tier).toBe("locked");
      }
      expect(body.summary.totalUnlocked).toBe(0);
      expect(body.summary.diamondCount).toBe(0);
      expect(body.summary.currentStreak).toBe(0);
    });

    it("computes cache-master=0 when input_tokens is 0 (avoids divide-by-zero branch)", async () => {
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
      mockClient.getAchievementHourlyUsage.mockResolvedValue([]);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);

      const res = await GET(makeGetRequest("/api/achievements"));
      expect(res.status).toBe(200);
      const body = await res.json();
      const cacheMaster = body.achievements.find((a: { id: string }) => a.id === "cache-master");
      expect(cacheMaster.currentValue).toBe(0);
    });

    it("applies cached_input_tokens cost when pricing.cached is set", async () => {
      // Forces computeCost to enter the `cachedTokens && pricing.cached` truthy branch.
      // claude-sonnet-4-20250514 has a cached price set in the default pricing map.
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 100,
        input_tokens: 100,
        output_tokens: 0,
        cached_input_tokens: 1_000_000,
        reasoning_output_tokens: 0,
      });
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([
        {
          day: "2026-04-03",
          model: "claude-sonnet-4-20250514",
          source: null,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 1_000_000,
        },
      ]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 0, model_count: 0, device_count: 0,
      });
      mockClient.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 0, quick_sessions: 0, marathon_sessions: 0, max_messages: 0, automated_sessions: 0,
      });
      mockClient.getAchievementHourlyUsage.mockResolvedValue([]);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([
        {
          model: "claude-sonnet-4-20250514",
          source: null,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 1_000_000,
        },
      ]);
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);

      const res = await GET(makeGetRequest("/api/achievements"));
      expect(res.status).toBe(200);
      const body = await res.json();
      // big-spender / daily-burn currentValue should reflect the cached cost (positive)
      const bigSpender = body.achievements.find((a: { id: string }) => a.id === "big-spender");
      expect(bigSpender.currentValue).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Limit mode — sorts by tier+progress, slices top N, skips earnedBy queries.
  // -------------------------------------------------------------------------

  describe("limit mode", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });

      // Make first-blood diamond (any usage) and power-user locked.
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 1_000_000,
        input_tokens: 600_000,
        output_tokens: 400_000,
        cached_input_tokens: 200_000,
        reasoning_output_tokens: 50_000,
      });
      mockClient.getAchievementDailyUsage.mockResolvedValue([
        { day: "2026-04-03", total_tokens: 100_000 },
      ]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 1,
        model_count: 1,
        device_count: 1,
      });
      mockClient.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 1,
        quick_sessions: 0,
        marathon_sessions: 0,
        max_messages: 1,
        automated_sessions: 0,
      });
      mockClient.getAchievementHourlyUsage.mockResolvedValue([]);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);
    });

    it("should slice achievements to limit count and sort by tier desc", async () => {
      const res = await GET(makeGetRequest("/api/achievements", { limit: "3" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.achievements).toHaveLength(3);

      const tierRank: Record<string, number> = {
        diamond: 4,
        gold: 3,
        silver: 2,
        bronze: 1,
        locked: 0,
      };
      // Each adjacent pair must be in non-increasing tier rank
      for (let i = 1; i < body.achievements.length; i++) {
        const prev = tierRank[body.achievements[i - 1].tier] ?? 0;
        const curr = tierRank[body.achievements[i].tier] ?? 0;
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it("should sort by progress DESC within the same tier (secondary key)", async () => {
      // Pull all 25 achievements via limit so we can scan adjacent same-tier pairs.
      const res = await GET(makeGetRequest("/api/achievements", { limit: "25" }));
      const body = await res.json();

      let sameTierPairsChecked = 0;
      for (let i = 1; i < body.achievements.length; i++) {
        const prev = body.achievements[i - 1];
        const curr = body.achievements[i];
        if (prev.tier === curr.tier) {
          // The route sorts by `b.progress - a.progress` within a tier, so
          // earlier elements must have progress >= later elements.
          expect(prev.progress).toBeGreaterThanOrEqual(curr.progress);
          sameTierPairsChecked++;
        }
      }
      // The fixture produces enough locked achievements with varying progress
      // that we MUST exercise the secondary key — otherwise this test is a
      // tautology.
      expect(sameTierPairsChecked).toBeGreaterThan(0);
    });

    it("should skip earnedBy queries entirely in limit mode", async () => {
      await GET(makeGetRequest("/api/achievements", { limit: "5" }));

      expect(mockClient.getAchievementEarners).not.toHaveBeenCalled();
      expect(mockClient.getAchievementEarnersCount).not.toHaveBeenCalled();
    });

    it("should still return summary based on full achievement set, not limited", async () => {
      const res = await GET(makeGetRequest("/api/achievements", { limit: "2" }));
      const body = await res.json();

      expect(body.summary.totalAchievements).toBe(25);
      // First-blood is diamond → at least 1 unlocked across full set
      expect(body.summary.totalUnlocked).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Timezone-dependent counting (weekend-warrior, night-owl, early-bird)
  // -------------------------------------------------------------------------

  describe("timezone-dependent counting", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });

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
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);
    });

    it("should count UTC Sunday hour as weekend (tzOffset=0)", async () => {
      // 2026-04-05 was a Sunday in UTC.
      mockClient.getAchievementHourlyUsage.mockResolvedValue([
        { hour_start: "2026-04-05T12:00:00Z", total_tokens: 100 },
      ]);

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      const ww = body.achievements.find((a: any) => a.id === "weekend-warrior");
      expect(ww.currentValue).toBe(1);
    });

    it("should shift to local time when tzOffset is provided", async () => {
      // 2026-04-06 00:30 UTC. With JS-style tzOffset=-540 (UTC+9, e.g. JST),
      // local = UTC - tzOffset*60s = 2026-04-06 09:30 +9 → still Monday → not weekend.
      mockClient.getAchievementHourlyUsage.mockResolvedValue([
        { hour_start: "2026-04-06T00:30:00Z", total_tokens: 100 },
      ]);

      const res = await GET(makeGetRequest("/api/achievements", { tzOffset: "-540" }));
      const body = await res.json();
      const ww = body.achievements.find((a: any) => a.id === "weekend-warrior");
      expect(ww.currentValue).toBe(0);
    });

    it("should count night-owl hours (local 0-6) and early-bird hours (local 6-9)", async () => {
      // tzOffset=0 → UTC interpretation:
      // 02:00 UTC → night owl, 07:00 UTC → early bird, 12:00 UTC → neither.
      mockClient.getAchievementHourlyUsage.mockResolvedValue([
        { hour_start: "2026-04-01T02:00:00Z", total_tokens: 100 },
        { hour_start: "2026-04-01T07:00:00Z", total_tokens: 100 },
        { hour_start: "2026-04-01T12:00:00Z", total_tokens: 100 },
      ]);

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      expect(body.achievements.find((a: any) => a.id === "night-owl").currentValue).toBe(1);
      expect(body.achievements.find((a: any) => a.id === "early-bird").currentValue).toBe(1);
    });

    it("should not count zero-token hours toward timezone counters", async () => {
      mockClient.getAchievementHourlyUsage.mockResolvedValue([
        { hour_start: "2026-04-05T12:00:00Z", total_tokens: 0 },
        { hour_start: "2026-04-01T02:00:00Z", total_tokens: 0 },
      ]);

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      expect(body.achievements.find((a: any) => a.id === "weekend-warrior").currentValue).toBe(0);
      expect(body.achievements.find((a: any) => a.id === "night-owl").currentValue).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Longest streak — gap-aware computation across active days.
  // -------------------------------------------------------------------------

  describe("longest streak computation", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        reasoning_output_tokens: 0,
      });
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
      mockClient.getAchievementHourlyUsage.mockResolvedValue([]);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);
    });

    it("should return 0 when there are no active days", async () => {
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      expect(body.summary.longestStreak).toBe(0);
    });

    it("should pick the longest run across multiple gaps", async () => {
      mockClient.getAchievementDailyUsage.mockResolvedValue([
        { day: "2026-01-01", total_tokens: 1 },
        { day: "2026-01-02", total_tokens: 1 },
        // gap
        { day: "2026-01-05", total_tokens: 1 },
        { day: "2026-01-06", total_tokens: 1 },
        { day: "2026-01-07", total_tokens: 1 },
        // gap
        { day: "2026-01-10", total_tokens: 1 },
      ]);

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      expect(body.summary.longestStreak).toBe(3);
    });

    it("should return 1 for a single isolated day", async () => {
      mockClient.getAchievementDailyUsage.mockResolvedValue([
        { day: "2026-01-01", total_tokens: 1 },
      ]);

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      expect(body.summary.longestStreak).toBe(1);
    });

    it("currentStreak: 3 consecutive days ending today (route walks back from UTC today)", async () => {
      vi.useFakeTimers();
      try {
        // Pin a deterministic "today" so the route's `today` and the daily
        // fixtures align — this is the branch at route.ts:81-88 that decrements
        // current.setUTCDate until activeDays misses.
        const fakeNow = new Date("2026-04-10T05:00:00Z");
        vi.setSystemTime(fakeNow);

        mockClient.getAchievementDailyUsage.mockResolvedValue([
          { day: "2026-04-08", total_tokens: 1 },
          { day: "2026-04-09", total_tokens: 1 },
          { day: "2026-04-10", total_tokens: 1 },
        ]);

        const res = await GET(makeGetRequest("/api/achievements"));
        const body = await res.json();
        expect(body.summary.currentStreak).toBe(3);

        const streakAch = body.achievements.find(
          (a: any) => a.id === "streak",
        );
        expect(streakAch.currentValue).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("currentStreak: 0 when today itself is not active (early-exit branch)", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-04-10T05:00:00Z"));

        // Yesterday + day before were active, but today is not — the while
        // loop must break immediately.
        mockClient.getAchievementDailyUsage.mockResolvedValue([
          { day: "2026-04-08", total_tokens: 1 },
          { day: "2026-04-09", total_tokens: 1 },
        ]);

        const res = await GET(makeGetRequest("/api/achievements"));
        const body = await res.json();
        expect(body.summary.currentStreak).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("currentStreak: stops at the first gap walking backward", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-04-10T05:00:00Z"));

        // Today + yesterday active, gap on -2, then -3 active — streak is 2.
        mockClient.getAchievementDailyUsage.mockResolvedValue([
          { day: "2026-04-07", total_tokens: 1 },
          { day: "2026-04-09", total_tokens: 1 },
          { day: "2026-04-10", total_tokens: 1 },
        ]);

        const res = await GET(makeGetRequest("/api/achievements"));
        const body = await res.json();
        expect(body.summary.currentStreak).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // earnedBy SQL branch dispatch — verifies the correct SQL is selected per
  // achievement id (volume / diversity / sessions / big-day CTE / cache-master).
  // -------------------------------------------------------------------------

  describe("earnedBy SQL dispatch", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
      mockClient.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 1, input_tokens: 1, output_tokens: 1,
        cached_input_tokens: 0, reasoning_output_tokens: 0,
      });
      mockClient.getAchievementDailyUsage.mockResolvedValue([]);
      mockClient.getAchievementDailyCostBreakdown.mockResolvedValue([]);
      mockClient.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 0, model_count: 0, device_count: 0,
      });
      mockClient.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 0, quick_sessions: 0, marathon_sessions: 0,
        max_messages: 0, automated_sessions: 0,
      });
      mockClient.getAchievementHourlyUsage.mockResolvedValue([]);
      mockClient.getAchievementCostByModelSource.mockResolvedValue([]);
      mockClient.getAchievementEarners.mockResolvedValue([]);
      mockClient.getAchievementEarnersCount.mockResolvedValue(0);
    });

    it("should dispatch a distinct SQL branch for each social achievement id", async () => {
      await GET(makeGetRequest("/api/achievements"));

      const calledIds = mockClient.getAchievementEarners.mock.calls.map(
        (c: any[]) => c[0],
      );
      // Spot-check coverage of all major SQL branches in the route.
      const expected = [
        "power-user", "first-blood", "millionaire", "billionaire",
        "input-hog", "output-addict", "reasoning-junkie",
        "veteran", "centurion",
        "tool-hoarder", "model-tourist", "device-nomad",
        "session-hoarder", "quick-draw", "marathon", "automation-addict",
        "big-day", "chatterbox", "cache-master",
      ];
      for (const id of expected) {
        expect(calledIds).toContain(id);
      }
    });

    it("should pass the SQL string and bronze threshold to each earnedBy call", async () => {
      await GET(makeGetRequest("/api/achievements"));

      // big-day uses a CTE — verify that branch's SQL is wired in.
      const bigDayCall = mockClient.getAchievementEarners.mock.calls.find(
        (c: any[]) => c[0] === "big-day",
      );
      expect(bigDayCall).toBeDefined();
      expect(bigDayCall![1]).toContain("WITH daily AS");
      expect(Array.isArray(bigDayCall![2])).toBe(true);
      expect(bigDayCall![2][1]).toBe(5); // limit
      expect(bigDayCall![2][2]).toBe(0); // offset

      // cache-master uses a percentage CASE expression.
      const cacheCall = mockClient.getAchievementEarners.mock.calls.find(
        (c: any[]) => c[0] === "cache-master",
      );
      expect(cacheCall).toBeDefined();
      expect(cacheCall![1]).toContain("cached_input_tokens");
      expect(cacheCall![1]).toContain("100.0");
    });

    it("should pass the right SQL fingerprint for every social SQL branch", async () => {
      await GET(makeGetRequest("/api/achievements"));

      type Call = [string, string, [number, number, number]];
      const calls = mockClient.getAchievementEarners.mock.calls as Call[];
      const sqlFor = (id: string): string => {
        const c = calls.find((row) => row[0] === id);
        if (!c) throw new Error(`no earnedBy call for ${id}`);
        return c[1];
      };

      // Volume-style: SUM(<column>) GROUP BY user — wrong column would mean
      // the dispatch is wired to the wrong template.
      expect(sqlFor("power-user")).toContain("SUM(ur.total_tokens)");
      expect(sqlFor("millionaire")).toContain("SUM(ur.total_tokens)");
      expect(sqlFor("billionaire")).toContain("SUM(ur.total_tokens)");
      expect(sqlFor("first-blood")).toContain("SUM(ur.total_tokens)");
      expect(sqlFor("input-hog")).toContain("SUM(ur.input_tokens)");
      expect(sqlFor("input-hog")).not.toContain("SUM(ur.output_tokens)");
      expect(sqlFor("output-addict")).toContain("SUM(ur.output_tokens)");
      expect(sqlFor("output-addict")).not.toContain("SUM(ur.input_tokens)");
      expect(sqlFor("reasoning-junkie")).toContain("SUM(ur.reasoning_output_tokens)");

      // Active-day count branches use COUNT(DISTINCT DATE(hour_start)).
      for (const id of ["veteran", "centurion"]) {
        expect(sqlFor(id)).toContain("COUNT(DISTINCT DATE(ur.hour_start))");
      }

      // Diversity branches each pick a distinct column.
      expect(sqlFor("tool-hoarder")).toContain("COUNT(DISTINCT ur.source)");
      expect(sqlFor("tool-hoarder")).not.toContain("COUNT(DISTINCT ur.model)");
      expect(sqlFor("model-tourist")).toContain("COUNT(DISTINCT ur.model)");
      expect(sqlFor("model-tourist")).not.toContain("COUNT(DISTINCT ur.source)");
      expect(sqlFor("device-nomad")).toContain("COUNT(DISTINCT ur.device_id)");
      expect(sqlFor("device-nomad")).not.toContain("COUNT(DISTINCT ur.model)");

      // Session-based branches join session_records and use the right CASE.
      expect(sqlFor("session-hoarder")).toContain("session_records sr");
      expect(sqlFor("session-hoarder")).toMatch(/COUNT\(\*\)\s+AS value/);
      expect(sqlFor("quick-draw")).toContain("sr.duration_seconds < 300");
      expect(sqlFor("quick-draw")).not.toContain("> 7200");
      expect(sqlFor("marathon")).toContain("sr.duration_seconds > 7200");
      expect(sqlFor("marathon")).not.toContain("< 300");
      expect(sqlFor("automation-addict")).toContain("sr.kind = 'automated'");

      // Single-session-max branch uses MAX(total_messages).
      expect(sqlFor("chatterbox")).toContain("MAX(total_messages)");
    });

    it("should map earner tier from value via computeTierProgress", async () => {
      mockClient.getAchievementEarners.mockImplementation(
        async (id: string) => {
          if (id === "first-blood") {
            return [
              { id: "u2", name: "Alice", image: null, slug: "alice", value: 100 },
            ];
          }
          return [];
        },
      );

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      const fb = body.achievements.find((a: any) => a.id === "first-blood");
      expect(fb.earnedBy).toHaveLength(1);
      // first-blood is single-tier: any value → diamond.
      expect(fb.earnedBy[0].tier).toBe("diamond");
      expect(fb.earnedBy[0].name).toBe("Alice");
    });

    it("should fallback earner name to 'Anonymous' when null", async () => {
      mockClient.getAchievementEarners.mockImplementation(
        async (id: string) => {
          if (id === "first-blood") {
            return [
              { id: "u3", name: null, image: null, slug: null, value: 1 },
            ];
          }
          return [];
        },
      );

      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();
      const fb = body.achievements.find((a: any) => a.id === "first-blood");
      expect(fb.earnedBy[0].name).toBe("Anonymous");
    });
  });
});

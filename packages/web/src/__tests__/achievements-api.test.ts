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

      // Setup default mock responses for all queries
      // 1. Usage aggregates
      mockClient.firstOrNull.mockResolvedValueOnce({
        total_tokens: 1_000_000,
        input_tokens: 600_000,
        output_tokens: 400_000,
        cached_input_tokens: 200_000,
        reasoning_output_tokens: 50_000,
      });
      // 2. Daily usage
      mockClient.query.mockResolvedValueOnce({
        results: [
          { day: "2026-04-03", total_tokens: 100_000 },
          { day: "2026-04-04", total_tokens: 200_000 },
          { day: "2026-04-05", total_tokens: 150_000 },
        ],
      });
      // 3. Cost by model/day
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            day: "2026-04-03",
            model: "claude-sonnet-4-20250514",
            input_tokens: 50_000,
            output_tokens: 30_000,
            cached_input_tokens: 10_000,
          },
        ],
      });
      // 4. Diversity counts
      mockClient.firstOrNull.mockResolvedValueOnce({
        source_count: 3,
        model_count: 5,
        device_count: 2,
      });
      // 5. Session aggregates
      mockClient.firstOrNull.mockResolvedValueOnce({
        total_sessions: 50,
        quick_sessions: 20,
        marathon_sessions: 5,
        max_messages: 150,
        automated_sessions: 10,
      });
      // 6. Hourly usage
      mockClient.query.mockResolvedValueOnce({
        results: [
          { hour_start: "2026-04-05T02:00:00Z", total_tokens: 10_000 },
          { hour_start: "2026-04-05T07:00:00Z", total_tokens: 20_000 },
        ],
      });
      // 7. Cost by model
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            model: "claude-sonnet-4-20250514",
            input_tokens: 600_000,
            output_tokens: 400_000,
            cached_input_tokens: 200_000,
          },
        ],
      });
      // 8. EarnedBy query (power-user)
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u2", name: "Alice", image: null, slug: "alice", total_tokens: 50_000_000 },
        ],
      });
      // 9. Count total earners
      mockClient.firstOrNull.mockResolvedValueOnce({ count: 5 });
    });

    it("should return achievements array and summary", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.achievements).toBeDefined();
      expect(Array.isArray(body.achievements)).toBe(true);
      expect(body.achievements.length).toBe(25);

      expect(body.summary).toBeDefined();
      expect(body.summary.totalAchievements).toBe(25);
      expect(typeof body.summary.totalUnlocked).toBe("number");
      expect(typeof body.summary.diamondCount).toBe("number");
      expect(typeof body.summary.currentStreak).toBe("number");
    });

    it("should return all achievement fields", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();

      const ach = body.achievements[0];
      expect(ach.id).toBeDefined();
      expect(ach.name).toBeDefined();
      expect(ach.flavorText).toBeDefined();
      expect(ach.icon).toBeDefined();
      expect(ach.category).toBeDefined();
      expect(ach.tier).toBeDefined();
      expect(typeof ach.currentValue).toBe("number");
      expect(ach.tiers).toHaveLength(4);
      expect(typeof ach.progress).toBe("number");
      expect(ach.displayValue).toBeDefined();
      expect(ach.displayThreshold).toBeDefined();
      expect(ach.unit).toBeDefined();
      expect(Array.isArray(ach.earnedBy)).toBe(true);
      expect(typeof ach.totalEarned).toBe("number");
    });

    it("should compute correct achievement tiers", async () => {
      const res = await GET(makeGetRequest("/api/achievements"));
      const body = await res.json();

      // power-user: 1M tokens, tiers [100K, 1M, 10M, 50M] → silver
      const powerUser = body.achievements.find((a: any) => a.id === "power-user");
      expect(powerUser.tier).toBe("silver");
      expect(powerUser.currentValue).toBe(1_000_000);

      // first-blood: any usage unlocks diamond (single-tier)
      const firstBlood = body.achievements.find((a: any) => a.id === "first-blood");
      expect(firstBlood.tier).toBe("diamond");

      // streak: depends on whether mock dates include today, so just verify structure
      const streak = body.achievements.find((a: any) => a.id === "streak");
      expect(typeof streak.currentValue).toBe("number");
      expect(streak.tiers).toEqual([3, 7, 14, 30]);

      // veteran: 3 unique active days in mock data
      const veteran = body.achievements.find((a: any) => a.id === "veteran");
      expect(veteran.currentValue).toBe(3);
      // tiers [7, 30, 90, 365] → 3 days = locked
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
      mockClient.firstOrNull.mockResolvedValue({
        total_tokens: 100_000,
        input_tokens: 60_000,
        output_tokens: 40_000,
        cached_input_tokens: 20_000,
        reasoning_output_tokens: 5_000,
      });
      mockClient.query.mockResolvedValue({ results: [] });
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
      mockClient.firstOrNull.mockRejectedValueOnce(new Error("DB connection failed"));

      const res = await GET(makeGetRequest("/api/achievements"));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to compute achievements");
    });
  });
});

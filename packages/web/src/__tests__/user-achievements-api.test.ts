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
      mockClient.firstOrNull.mockResolvedValueOnce(null);

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
      mockClient.firstOrNull.mockResolvedValueOnce(null);

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
      mockClient.firstOrNull
        .mockResolvedValueOnce({ id: "u1", name: "Test User" })
        // Usage aggregates
        .mockResolvedValueOnce({
          total_tokens: 5_000_000_000, // 5B tokens
          input_tokens: 3_000_000_000,
          output_tokens: 2_000_000_000,
          cached_input_tokens: 1_000_000_000,
          reasoning_output_tokens: 100_000_000,
        })
        // Diversity
        .mockResolvedValueOnce({
          source_count: 4,
          model_count: 8,
          device_count: 3,
        })
        // Session aggregates
        .mockResolvedValueOnce({
          total_sessions: 500,
          quick_sessions: 200,
          marathon_sessions: 30,
          max_messages: 250,
          automated_sessions: 50,
        });

      // Daily usage
      mockClient.query
        .mockResolvedValueOnce({
          results: [
            { day: "2026-04-01", total_tokens: 100_000_000 },
            { day: "2026-04-02", total_tokens: 500_000_000 },
            { day: "2026-04-03", total_tokens: 200_000_000 },
          ],
        })
        // Cost by model/source/day
        .mockResolvedValueOnce({
          results: [
            {
              day: "2026-04-02",
              model: "claude-sonnet-4-20250514",
              source: "claude-code",
              input_tokens: 300_000_000,
              output_tokens: 200_000_000,
              cached_input_tokens: 100_000_000,
            },
          ],
        })
        // Cost by model/source (total)
        .mockResolvedValueOnce({
          results: [
            {
              model: "claude-sonnet-4-20250514",
              source: "claude-code",
              input_tokens: 3_000_000_000,
              output_tokens: 2_000_000_000,
              cached_input_tokens: 1_000_000_000,
            },
          ],
        });
    });

    it("should return achievements and summary", async () => {
      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      // Should have achievements array
      expect(body.achievements).toBeDefined();
      expect(Array.isArray(body.achievements)).toBe(true);
      expect(body.achievements.length).toBeLessThanOrEqual(6); // Top 6 only

      // Should have summary
      expect(body.summary).toBeDefined();
      expect(typeof body.summary.totalUnlocked).toBe("number");
      expect(typeof body.summary.totalAchievements).toBe("number");
      expect(typeof body.summary.diamondCount).toBe("number");
      expect(typeof body.summary.currentStreak).toBe("number");
    });

    it("should return achievement fields correctly", async () => {
      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

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
      mockClient.firstOrNull.mockRejectedValueOnce(new Error("DB connection failed"));

      const res = await GET(
        makeGetRequest("/api/users/test-user/achievements"),
        { params: Promise.resolve({ slug: "test-user" }) }
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to compute achievements");
    });
  });
});

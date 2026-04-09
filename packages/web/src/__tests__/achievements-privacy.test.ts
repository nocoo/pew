import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/users/[slug]/achievements/route";
import * as dbModule from "@/lib/db";
import { createMockDbRead } from "./test-utils";

// Mock DB
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

function makeRequest(
  slug: string,
): [Request, { params: Promise<{ slug: string }> }] {
  const url = new URL(`http://localhost:7020/api/users/${slug}/achievements`);
  return [
    new Request(url.toString()),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("GET /api/users/[slug]/achievements", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
  });

  describe("is_public privacy gate", () => {
    it("should return 404 when user has is_public = 0", async () => {
      mockDbRead.getPublicUserBySlugOrId.mockResolvedValueOnce({
        id: "u1",
        name: "Private User",
        image: null,
        slug: "privuser",
        is_public: 0,
        created_at: "2026-01-01",
      });

      const [req, ctx] = makeRequest("privuser");
      const res = await GET(req, ctx);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("User not found");

      // Should NOT call achievement data methods
      expect(mockDbRead.getAchievementUsageAggregates).not.toHaveBeenCalled();
    });

    it("should return 404 when user not found", async () => {
      mockDbRead.getPublicUserBySlugOrId.mockResolvedValueOnce(null);

      const [req, ctx] = makeRequest("nobody");
      const res = await GET(req, ctx);

      expect(res.status).toBe(404);
      expect(mockDbRead.getAchievementUsageAggregates).not.toHaveBeenCalled();
    });

    it("should return achievements when user has is_public = 1", async () => {
      mockDbRead.getPublicUserBySlugOrId.mockResolvedValueOnce({
        id: "u1",
        name: "Public User",
        image: null,
        slug: "pubuser",
        is_public: 1,
        created_at: "2026-01-01",
      });

      // Setup achievement mocks
      mockDbRead.getAchievementUsageAggregates.mockResolvedValueOnce({
        total_tokens: 100_000,
        input_tokens: 60_000,
        output_tokens: 40_000,
        cached_input_tokens: 20_000,
        reasoning_output_tokens: 5_000,
      });
      mockDbRead.getAchievementDailyUsage.mockResolvedValueOnce([
        { day: "2026-04-01", total_tokens: 50_000 },
      ]);
      mockDbRead.getAchievementDailyCostBreakdown.mockResolvedValueOnce([]);
      mockDbRead.getAchievementDiversityCounts.mockResolvedValueOnce({
        source_count: 2,
        model_count: 3,
        device_count: 1,
      });
      mockDbRead.getAchievementSessionAggregates.mockResolvedValueOnce({
        total_sessions: 10,
        quick_sessions: 5,
        marathon_sessions: 1,
        max_messages: 50,
        automated_sessions: 2,
      });
      mockDbRead.getAchievementCostByModelSource.mockResolvedValueOnce([]);

      const [req, ctx] = makeRequest("pubuser");
      const res = await GET(req, ctx);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.achievements).toBeDefined();
      expect(Array.isArray(body.achievements)).toBe(true);
      expect(body.summary).toBeDefined();
      expect(typeof body.summary.totalUnlocked).toBe("number");
    });

    it("should not leak achievement data for private users", async () => {
      // Even if we somehow have achievement data for a private user,
      // the 404 should prevent any data from being returned
      mockDbRead.getPublicUserBySlugOrId.mockResolvedValueOnce({
        id: "u1",
        name: "Has Achievements But Private",
        image: null,
        slug: "hidden",
        is_public: 0,
        created_at: "2026-01-01",
      });

      const [req, ctx] = makeRequest("hidden");
      const res = await GET(req, ctx);

      expect(res.status).toBe(404);
      const body = await res.json();

      // Should not contain any achievement-related fields
      expect(body.achievements).toBeUndefined();
      expect(body.summary).toBeUndefined();
      expect(body.error).toBe("User not found");
    });
  });

  describe("response structure for public users", () => {
    beforeEach(() => {
      mockDbRead.getPublicUserBySlugOrId.mockResolvedValue({
        id: "u1",
        name: "Test User",
        image: null,
        slug: "testuser",
        is_public: 1,
        created_at: "2026-01-01",
      });

      mockDbRead.getAchievementUsageAggregates.mockResolvedValue({
        total_tokens: 1_000_000,
        input_tokens: 600_000,
        output_tokens: 400_000,
        cached_input_tokens: 200_000,
        reasoning_output_tokens: 50_000,
      });

      mockDbRead.getAchievementDailyUsage.mockResolvedValue([
        { day: "2026-04-03", total_tokens: 100_000 },
        { day: "2026-04-04", total_tokens: 200_000 },
      ]);

      mockDbRead.getAchievementDailyCostBreakdown.mockResolvedValue([
        {
          day: "2026-04-03",
          model: "claude-sonnet-4-20250514",
          source: null,
          input_tokens: 50_000,
          output_tokens: 30_000,
          cached_input_tokens: 10_000,
        },
      ]);

      mockDbRead.getAchievementDiversityCounts.mockResolvedValue({
        source_count: 3,
        model_count: 5,
        device_count: 2,
      });

      mockDbRead.getAchievementSessionAggregates.mockResolvedValue({
        total_sessions: 50,
        quick_sessions: 20,
        marathon_sessions: 5,
        max_messages: 150,
        automated_sessions: 10,
      });

      mockDbRead.getAchievementCostByModelSource.mockResolvedValue([]);
    });

    it("should return top 6 achievements sorted by tier and progress", async () => {
      const [req, ctx] = makeRequest("testuser");
      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.achievements).toHaveLength(6);

      // Each achievement should have required fields
      const ach = body.achievements[0];
      expect(ach.id).toBeDefined();
      expect(ach.name).toBeDefined();
      expect(ach.tier).toBeDefined();
      expect(typeof ach.progress).toBe("number");
    });

    it("should return summary with totals and streak", async () => {
      const [req, ctx] = makeRequest("testuser");
      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.summary.totalUnlocked).toBeDefined();
      expect(body.summary.totalAchievements).toBeDefined();
      expect(body.summary.diamondCount).toBeDefined();
      expect(body.summary.currentStreak).toBeDefined();
    });
  });
});

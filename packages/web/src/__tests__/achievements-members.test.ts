import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/achievements/[id]/members/route";
import * as dbModule from "@/lib/db";
import { createMockClient } from "./test-utils";

// Mock DB
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

const BASE = "http://localhost:7020";

function makeGetRequest(path: string, params: Record<string, string> = {}): Request {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

describe("GET /api/achievements/[id]/members", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockClient as any);
  });

  describe("validation", () => {
    it("should return 404 for unknown achievement", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/nonexistent/members"),
        { params: Promise.resolve({ id: "nonexistent" }) },
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should return 404 for timezone-dependent achievement", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/night-owl/members"),
        { params: Promise.resolve({ id: "night-owl" }) },
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("timezone-dependent");
    });

    it("should reject invalid limit", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members", { limit: "999" }),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("limit");
    });

    it("should reject invalid cursor", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members", { cursor: "abc" }),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("cursor");
    });
  });

  describe("response structure", () => {
    it("should return members array and cursor", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "Alice", image: null, slug: "alice", value: 5_000_000, first_activity: "2026-01-15T10:00:00Z" },
          { id: "u2", name: "Bob", image: "https://example.com/bob.jpg", slug: "bob", value: 2_000_000, first_activity: "2026-02-01T08:00:00Z" },
        ],
      });

      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members"),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.members).toBeDefined();
      expect(Array.isArray(body.members)).toBe(true);
      expect(body.members).toHaveLength(2);
      expect(body.cursor).toBeNull(); // No more results
    });

    it("should return correct member fields", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "Alice", image: "https://example.com/alice.jpg", slug: "alice", value: 50_000_000, first_activity: "2026-01-15T10:00:00Z" },
        ],
      });

      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members"),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      const body = await res.json();
      const member = body.members[0];

      expect(member.id).toBe("u1");
      expect(member.name).toBe("Alice");
      expect(member.image).toBe("https://example.com/alice.jpg");
      expect(member.slug).toBe("alice");
      expect(member.tier).toBe("diamond"); // 50M tokens with tiers [100K, 1M, 10M, 50M]
      expect(member.earnedAt).toBe("2026-01-15T10:00:00Z");
      expect(member.currentValue).toBe(50_000_000);
    });

    it("should compute correct tier from value", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "Diamond", image: null, slug: null, value: 50_000_000, first_activity: "2026-01-01T00:00:00Z" },
          { id: "u2", name: "Gold", image: null, slug: null, value: 10_000_000, first_activity: "2026-01-01T00:00:00Z" },
          { id: "u3", name: "Silver", image: null, slug: null, value: 1_000_000, first_activity: "2026-01-01T00:00:00Z" },
          { id: "u4", name: "Bronze", image: null, slug: null, value: 100_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members"),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      const body = await res.json();
      expect(body.members[0].tier).toBe("diamond");
      expect(body.members[1].tier).toBe("gold");
      expect(body.members[2].tier).toBe("silver");
      expect(body.members[3].tier).toBe("bronze");
    });

    it("should handle null name as Anonymous", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: null, image: null, slug: null, value: 1_000_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members"),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      const body = await res.json();
      expect(body.members[0].name).toBe("Anonymous");
    });
  });

  describe("pagination", () => {
    it("should return cursor when more results exist", async () => {
      // Mock returns limit+1 results to indicate more pages
      const results = Array.from({ length: 51 }, (_, i) => ({
        id: `u${i}`,
        name: `User ${i}`,
        image: null,
        slug: null,
        value: 5_000_000 - i * 10_000,
        first_activity: "2026-01-01T00:00:00Z",
      }));
      mockClient.query.mockResolvedValueOnce({ results });

      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members"),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      const body = await res.json();
      expect(body.members).toHaveLength(50); // Default limit
      expect(body.cursor).toBe("50"); // Next offset
    });

    it("should respect custom limit", async () => {
      const results = Array.from({ length: 11 }, (_, i) => ({
        id: `u${i}`,
        name: `User ${i}`,
        image: null,
        slug: null,
        value: 5_000_000 - i * 10_000,
        first_activity: "2026-01-01T00:00:00Z",
      }));
      mockClient.query.mockResolvedValueOnce({ results });

      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members", { limit: "10" }),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      const body = await res.json();
      expect(body.members).toHaveLength(10);
      expect(body.cursor).toBe("10");
    });

    it("should use cursor for offset", async () => {
      mockClient.query.mockResolvedValueOnce({ results: [] });

      await GET(
        makeGetRequest("/api/achievements/power-user/members", { cursor: "100", limit: "10" }),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      // Verify the query was called with correct offset
      expect(mockClient.query).toHaveBeenCalledOnce();
      const [, params] = mockClient.query.mock.calls[0]!;
      // Params are [threshold, limit+1, offset]
      expect(params![2]).toBe(100); // offset from cursor
    });
  });

  describe("achievements with no members query", () => {
    it("should return empty array for spending achievements (not implemented)", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/big-spender/members"),
        { params: Promise.resolve({ id: "big-spender" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members).toEqual([]);
      expect(body.cursor).toBeNull();
    });

    it("should return empty array for streak achievement (not implemented)", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/streak/members"),
        { params: Promise.resolve({ id: "streak" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members).toEqual([]);
      expect(body.cursor).toBeNull();
    });
  });

  describe("different achievement types", () => {
    it("should query session_records for session-based achievements (quick-draw)", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 100, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/quick-draw/members"),
        { params: Promise.resolve({ id: "quick-draw" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("session_records");
      expect(sql).toContain("duration_seconds < 300");
    });

    it("should query COUNT DISTINCT for diversity achievements (model-tourist)", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 5, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/model-tourist/members"),
        { params: Promise.resolve({ id: "model-tourist" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("COUNT(DISTINCT");
      expect(sql).toContain("model");
    });

    it("should query input_tokens for input-hog achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 1_000_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/input-hog/members"),
        { params: Promise.resolve({ id: "input-hog" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("input_tokens");
    });

    it("should query output_tokens for output-addict achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 1_000_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/output-addict/members"),
        { params: Promise.resolve({ id: "output-addict" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("output_tokens");
    });

    it("should query reasoning_output_tokens for reasoning-junkie achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 500_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/reasoning-junkie/members"),
        { params: Promise.resolve({ id: "reasoning-junkie" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("reasoning_output_tokens");
    });

    it("should query COUNT DISTINCT DATE for veteran achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 30, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/veteran/members"),
        { params: Promise.resolve({ id: "veteran" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("COUNT(DISTINCT DATE");
    });

    it("should query with CTE for big-day achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 100_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/big-day/members"),
        { params: Promise.resolve({ id: "big-day" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("WITH daily AS");
      expect(sql).toContain("MAX(day_tokens)");
    });

    it("should query cache rate for cache-master achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 50, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/cache-master/members"),
        { params: Promise.resolve({ id: "cache-master" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("cached_input_tokens");
      expect(sql).toContain("100.0");
    });

    it("should query COUNT DISTINCT source for tool-hoarder achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 5, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/tool-hoarder/members"),
        { params: Promise.resolve({ id: "tool-hoarder" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("COUNT(DISTINCT");
      expect(sql).toContain("source");
    });

    it("should query COUNT DISTINCT device_id for device-nomad achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 3, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/device-nomad/members"),
        { params: Promise.resolve({ id: "device-nomad" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("COUNT(DISTINCT");
      expect(sql).toContain("device_id");
    });

    it("should query marathon sessions for marathon achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 10, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/marathon/members"),
        { params: Promise.resolve({ id: "marathon" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("session_records");
      expect(sql).toContain("duration_seconds > 7200");
    });

    it("should query max messages for chatterbox achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 200, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/chatterbox/members"),
        { params: Promise.resolve({ id: "chatterbox" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("MAX(total_messages)");
    });

    it("should query session count for session-hoarder achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 500, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/session-hoarder/members"),
        { params: Promise.resolve({ id: "session-hoarder" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("session_records");
      expect(sql).toContain("COUNT(*)");
    });

    it("should query automated sessions for automation-addict achievement", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 50, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/automation-addict/members"),
        { params: Promise.resolve({ id: "automation-addict" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("kind = 'automated'");
    });

    it("should query centurion same as veteran", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 100, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/centurion/members"),
        { params: Promise.resolve({ id: "centurion" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("COUNT(DISTINCT DATE");
    });

    it("should query first-blood same as power-user", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 1, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/first-blood/members"),
        { params: Promise.resolve({ id: "first-blood" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("total_tokens");
    });

    it("should query millionaire same as power-user", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 1_000_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/millionaire/members"),
        { params: Promise.resolve({ id: "millionaire" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("total_tokens");
    });

    it("should query billionaire same as power-user", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          { id: "u1", name: "User", image: null, slug: null, value: 1_000_000_000, first_activity: "2026-01-01T00:00:00Z" },
        ],
      });

      await GET(
        makeGetRequest("/api/achievements/billionaire/members"),
        { params: Promise.resolve({ id: "billionaire" }) },
      );

      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql] = mockClient.query.mock.calls[0]!;
      expect(sql).toContain("total_tokens");
    });

    it("should return empty for daily-burn (not implemented)", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/daily-burn/members"),
        { params: Promise.resolve({ id: "daily-burn" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members).toEqual([]);
      expect(body.cursor).toBeNull();
    });

    it("should return 404 for weekend-warrior (timezone-dependent)", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/weekend-warrior/members"),
        { params: Promise.resolve({ id: "weekend-warrior" }) },
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("timezone-dependent");
    });

    it("should return 404 for early-bird (timezone-dependent)", async () => {
      const res = await GET(
        makeGetRequest("/api/achievements/early-bird/members"),
        { params: Promise.resolve({ id: "early-bird" }) },
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("timezone-dependent");
    });
  });

  describe("error handling", () => {
    it("should return 500 on database error", async () => {
      mockClient.query.mockRejectedValueOnce(new Error("DB connection failed"));

      const res = await GET(
        makeGetRequest("/api/achievements/power-user/members"),
        { params: Promise.resolve({ id: "power-user" }) },
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to fetch achievement members");
    });
  });
});

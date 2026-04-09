import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/usage/route";
import * as dbModule from "@/lib/db";
import { createMockDbRead, makeGetRequest } from "./test-utils";

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

describe("GET /api/usage", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
  });

  describe("authentication", () => {
    it("should reject unauthenticated requests", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await GET(makeGetRequest("/api/usage"));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("query params", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should query with default date range (last 30 days)", async () => {
      mockDbRead.getUsageRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage"));

      expect(res.status).toBe(200);
      expect(mockDbRead.getUsageRecords).toHaveBeenCalledOnce();
      const [userId] = mockDbRead.getUsageRecords.mock.calls[0]!;
      expect(userId).toBe("u1");
    });

    it("should accept custom from/to date range", async () => {
      mockDbRead.getUsageRecords.mockResolvedValueOnce([]);

      const res = await GET(
        makeGetRequest("/api/usage", {
          from: "2026-03-01",
          to: "2026-03-07",
        })
      );

      expect(res.status).toBe(200);
      const [, fromDate, toDate] = mockDbRead.getUsageRecords.mock.calls[0]!;
      expect(fromDate).toBe("2026-03-01T00:00:00.000Z");
      // Bare-date `to` is treated as inclusive: bumped +1 day for `< toDate`
      expect(toDate).toBe("2026-03-08T00:00:00.000Z");
    });

    it("should filter by source", async () => {
      mockDbRead.getUsageRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage", { source: "claude-code" }));

      expect(res.status).toBe(200);
      const [, , , options] = mockDbRead.getUsageRecords.mock.calls[0]!;
      expect(options.source).toBe("claude-code");
    });

    it("should reject invalid source filter", async () => {
      const res = await GET(makeGetRequest("/api/usage", { source: "invalid-tool" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("source");
    });

    it("should reject invalid date format for from", async () => {
      const res = await GET(makeGetRequest("/api/usage", { from: "not-a-date" }));

      expect(res.status).toBe(400);
    });
  });

  describe("response format", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should return aggregated records", async () => {
      mockDbRead.getUsageRecords.mockResolvedValueOnce([
        {
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          hour_start: "2026-03-07T10:00:00.000Z",
          input_tokens: 5000,
          cached_input_tokens: 1000,
          output_tokens: 2000,
          reasoning_output_tokens: 0,
          total_tokens: 7000,
        },
        {
          source: "opencode",
          model: "o3",
          hour_start: "2026-03-07T10:00:00.000Z",
          input_tokens: 3000,
          cached_input_tokens: 500,
          output_tokens: 1000,
          reasoning_output_tokens: 200,
          total_tokens: 4200,
        },
      ]);

      const res = await GET(makeGetRequest("/api/usage"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.records).toHaveLength(2);
      expect(body.records[0].source).toBe("claude-code");
      expect(body.records[1].source).toBe("opencode");
    });

    it("should include summary totals", async () => {
      mockDbRead.getUsageRecords.mockResolvedValueOnce([
        {
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          hour_start: "2026-03-07T10:00:00.000Z",
          input_tokens: 5000,
          cached_input_tokens: 1000,
          output_tokens: 2000,
          reasoning_output_tokens: 0,
          total_tokens: 7000,
        },
        {
          source: "opencode",
          model: "o3",
          hour_start: "2026-03-07T10:30:00.000Z",
          input_tokens: 3000,
          cached_input_tokens: 500,
          output_tokens: 1000,
          reasoning_output_tokens: 200,
          total_tokens: 4200,
        },
      ]);

      const res = await GET(makeGetRequest("/api/usage"));

      const body = await res.json();
      expect(body.summary).toBeDefined();
      expect(body.summary.total_tokens).toBe(11200);
      expect(body.summary.input_tokens).toBe(8000);
      expect(body.summary.output_tokens).toBe(3000);
    });

    it("should return empty records when no data", async () => {
      mockDbRead.getUsageRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage"));

      const body = await res.json();
      expect(body.records).toEqual([]);
      expect(body.summary.total_tokens).toBe(0);
    });

    it("should pass granularity option", async () => {
      mockDbRead.getUsageRecords.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage", { granularity: "day" }));

      expect(res.status).toBe(200);
      const [, , , options] = mockDbRead.getUsageRecords.mock.calls[0]!;
      expect(options.granularity).toBe("day");
    });

    it("should return 500 on D1 error", async () => {
      mockDbRead.getUsageRecords.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(makeGetRequest("/api/usage"));

      expect(res.status).toBe(500);
    });
  });
});

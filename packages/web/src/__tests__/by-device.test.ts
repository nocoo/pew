import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/usage/by-device/route";
import * as dbModule from "@/lib/db";
import { createMockDbRead, loadMockedAuthHelpers, makeGetRequest } from "./test-utils";

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

const { resolveUser } = await loadMockedAuthHelpers();

describe("GET /api/usage/by-device", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    // Default dynamic pricing stub: empty (so loadPricingMap falls through to
    // safety net unless the test overrides it).
    mockDbRead.getDynamicPricing.mockResolvedValue({
      entries: [],
      servedFrom: "baseline",
    });
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
  });

  describe("authentication", () => {
    it("should reject unauthenticated requests", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await GET(makeGetRequest("/api/usage/by-device"));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("date and parameter validation", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should return 400 for invalid from date format", async () => {
      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "not-a-date" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid date format");
    });

    it("should return 400 for invalid to date format", async () => {
      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "bad" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid date format");
    });

    it("should return 400 for invalid tzOffset (NaN)", async () => {
      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11", tzOffset: "abc" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid tzOffset value");
    });

    it("should return 400 for tzOffset > 840", async () => {
      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11", tzOffset: "900" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid tzOffset value");
    });

    it("should use defaults when from/to not provided", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.devices).toEqual([]);
    });

    it("should pass half-hour granularity to DB", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11", granularity: "half-hour" }));
      expect(res.status).toBe(200);
      expect(mockDbRead.getDeviceTimeline).toHaveBeenCalledWith(
        "u1",
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ granularity: "half-hour" }),
      );
    });

    it("should handle bare date (YYYY-MM-DD) in to param by bumping +1 day", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-10" }));
      expect(res.status).toBe(200);
    });

    it("should handle full ISO to param without bumping", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-10T23:59:59Z" }));
      expect(res.status).toBe(200);
    });
  });

  describe("deviceDetails and empty sources", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should return deviceDetails in response", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          alias: null,
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 50000,
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
          reasoning_output_tokens: 0,
          sources: "",
          models: "",
        },
      ]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
        },
      ]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      // deviceDetails should be present
      expect(body.deviceDetails).toHaveLength(1);
      expect(body.deviceDetails[0].device_id).toBe("aaaa-1111");
      expect(body.deviceDetails[0].source).toBe("claude-code");
      expect(body.deviceDetails[0].total_tokens).toBe(30000 + 15000 + 5000);
      // Empty sources/models should produce empty arrays
      expect(body.devices[0].sources).toEqual([]);
    });

    it("should handle device with no cost rows (estimated_cost = 0)", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          alias: null,
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
          sources: null,
          models: null,
        },
      ]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.devices[0].estimated_cost).toBe(0);
      // null sources/models → empty array
      expect(body.devices[0].sources).toEqual([]);
    });
  });

  describe("response format", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should return devices and timeline for valid date range", async () => {
      // Summary RPC
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          alias: "MacBook Pro",
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 50000,
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
          reasoning_output_tokens: 0,
          sources: "claude-code",
          models: "claude-sonnet-4-20250514",
        },
        {
          device_id: "bbbb-2222",
          alias: null,
          first_seen: "2026-03-05T00:00:00Z",
          last_seen: "2026-03-10T10:00:00Z",
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 6000,
          cached_input_tokens: 2000,
          reasoning_output_tokens: 500,
          sources: "opencode",
          models: "o3",
        },
      ]);
      // Cost detail RPC
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
        },
        {
          device_id: "bbbb-2222",
          source: "opencode",
          model: "o3",
          input_tokens: 12000,
          output_tokens: 6000,
          cached_input_tokens: 2000,
        },
      ]);
      // Timeline RPC
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([
        {
          date: "2026-03-01",
          device_id: "aaaa-1111",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 3000,
          cached_input_tokens: 1000,
        },
        {
          date: "2026-03-01",
          device_id: "bbbb-2222",
          total_tokens: 5000,
          input_tokens: 3000,
          output_tokens: 1500,
          cached_input_tokens: 500,
        },
      ]);
      // Pricing RPC (no overrides)

      const res = await GET(
        makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.devices).toHaveLength(2);
      expect(body.timeline).toHaveLength(2);
      expect(body.devices[0].device_id).toBe("aaaa-1111");
      expect(body.devices[1].device_id).toBe("bbbb-2222");
    });

    it("should include estimated_cost per device", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          alias: null,
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 50000,
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
          reasoning_output_tokens: 0,
          sources: "claude-code",
          models: "claude-sonnet-4-20250514",
        },
      ]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
        },
      ]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(body.devices[0].estimated_cost).toBeTypeOf("number");
      expect(body.devices[0].estimated_cost).toBeGreaterThan(0);
    });

    it("should join alias from device_aliases", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          alias: "MacBook",
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 50000,
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
          reasoning_output_tokens: 0,
          sources: "claude-code",
          models: "claude-sonnet-4-20250514",
        },
        {
          device_id: "bbbb-2222",
          alias: null,
          first_seen: "2026-03-05T00:00:00Z",
          last_seen: "2026-03-10T10:00:00Z",
          total_tokens: 20000,
          input_tokens: 12000,
          output_tokens: 6000,
          cached_input_tokens: 2000,
          reasoning_output_tokens: 0,
          sources: "opencode",
          models: "o3",
        },
      ]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(body.devices[0].alias).toBe("MacBook");
      expect(body.devices[1].alias).toBeNull();
    });

    it("should include device_id = 'default' in results", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "default",
          alias: null,
          first_seen: "2026-01-01T00:00:00Z",
          last_seen: "2026-02-28T23:59:00Z",
          total_tokens: 200000,
          input_tokens: 120000,
          output_tokens: 60000,
          cached_input_tokens: 20000,
          reasoning_output_tokens: 0,
          sources: "claude-code",
          models: "claude-sonnet-4-20250514",
        },
      ]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([
        {
          device_id: "default",
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          input_tokens: 120000,
          output_tokens: 60000,
          cached_input_tokens: 20000,
        },
      ]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-01-01", to: "2026-03-01" }));
      const body = await res.json();

      expect(body.devices).toHaveLength(1);
      expect(body.devices[0].device_id).toBe("default");
    });

    it("should return sources and models as arrays", async () => {
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          alias: null,
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 50000,
          input_tokens: 30000,
          output_tokens: 15000,
          cached_input_tokens: 5000,
          reasoning_output_tokens: 0,
          sources: "claude-code,opencode",
          models: "claude-sonnet-4-20250514,o3",
        },
      ]);
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([]);
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(Array.isArray(body.devices[0].sources)).toBe(true);
      expect(body.devices[0].sources).toEqual(["claude-code", "opencode"]);
      expect(Array.isArray(body.devices[0].models)).toBe(true);
      expect(body.devices[0].models).toEqual(["claude-sonnet-4-20250514", "o3"]);
    });

    it("should return 500 on D1 error", async () => {
      mockDbRead.getDeviceSummary.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" }));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Failed to query");
    });
  });

  describe("pricing integration", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should use static pricing for known models", async () => {
      // Summary
      mockDbRead.getDeviceSummary.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          alias: null,
          first_seen: "2026-03-01T00:00:00Z",
          last_seen: "2026-03-10T12:00:00Z",
          total_tokens: 2_000_000,
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
          sources: "claude-code",
          models: "claude-sonnet-4-20250514",
        },
      ]);
      // Cost detail
      mockDbRead.getDeviceCostDetails.mockResolvedValueOnce([
        {
          device_id: "aaaa-1111",
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cached_input_tokens: 0,
        },
      ]);
      // Timeline
      mockDbRead.getDeviceTimeline.mockResolvedValueOnce([]);

      const res = await GET(
        makeGetRequest("/api/usage/by-device", { from: "2026-03-01", to: "2026-03-11" })
      );
      const body = await res.json();

      // Static pricing for claude-sonnet-4: (1M * $3/1M) + (1M * $15/1M) = $18
      expect(res.status).toBe(200);
      expect(body.devices[0].estimated_cost).toBe(18);
    });
  });
});

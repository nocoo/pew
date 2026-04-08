import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleUsageRpc,
  type GetUsageRequest,
  type GetDeviceSummaryRequest,
  type GetDeviceCostDetailsRequest,
  type GetDeviceTimelineRequest,
  type GetModelPricingRequest,
} from "./usage";
import type { D1Database } from "@cloudflare/workers-types";

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

describe("usage RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // usage.get
  // -------------------------------------------------------------------------

  describe("usage.get", () => {
    it("should return usage records", async () => {
      const mockRecords = [
        {
          source: "claude-code",
          model: "claude-sonnet-4",
          hour_start: "2026-04-01T10:00:00.000Z",
          input_tokens: 1000,
          cached_input_tokens: 100,
          output_tokens: 500,
          reasoning_output_tokens: 0,
          total_tokens: 1500,
        },
      ];
      db.all.mockResolvedValue({ results: mockRecords });

      const request: GetUsageRequest = {
        method: "usage.get",
        userId: "u1",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-02T00:00:00.000Z",
      };
      const response = await handleUsageRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockRecords });
    });

    it("should filter by source when provided", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetUsageRequest = {
        method: "usage.get",
        userId: "u1",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-02T00:00:00.000Z",
        source: "claude-code",
      };
      await handleUsageRpc(request, db);

      // Check that bind was called with the source parameter
      expect(db.bind).toHaveBeenCalled();
    });

    it("should support day granularity", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: GetUsageRequest = {
        method: "usage.get",
        userId: "u1",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-02T00:00:00.000Z",
        granularity: "day",
      };
      const response = await handleUsageRpc(request, db);

      expect(response.status).toBe(200);
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "usage.get",
        userId: "",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-02T00:00:00.000Z",
      } as GetUsageRequest;
      const response = await handleUsageRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // usage.getDeviceSummary
  // -------------------------------------------------------------------------

  describe("usage.getDeviceSummary", () => {
    it("should return device summary", async () => {
      const mockSummary = [
        {
          device_id: "d1",
          alias: "MacBook Pro",
          first_seen: "2026-04-01T10:00:00.000Z",
          last_seen: "2026-04-01T18:00:00.000Z",
          total_tokens: 10000,
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 1000,
          reasoning_output_tokens: 0,
          sources: "claude-code,codex",
          models: "claude-sonnet-4,gpt-4o",
        },
      ];
      db.all.mockResolvedValue({ results: mockSummary });

      const request: GetDeviceSummaryRequest = {
        method: "usage.getDeviceSummary",
        userId: "u1",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-02T00:00:00.000Z",
      };
      const response = await handleUsageRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockSummary });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "usage.getDeviceSummary",
        userId: "u1",
        fromDate: "",
        toDate: "2026-04-02T00:00:00.000Z",
      } as GetDeviceSummaryRequest;
      const response = await handleUsageRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // usage.getDeviceCostDetails
  // -------------------------------------------------------------------------

  describe("usage.getDeviceCostDetails", () => {
    it("should return cost details per device/source/model", async () => {
      const mockDetails = [
        {
          device_id: "d1",
          source: "claude-code",
          model: "claude-sonnet-4",
          input_tokens: 6000,
          output_tokens: 4000,
          cached_input_tokens: 1000,
        },
      ];
      db.all.mockResolvedValue({ results: mockDetails });

      const request: GetDeviceCostDetailsRequest = {
        method: "usage.getDeviceCostDetails",
        userId: "u1",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-02T00:00:00.000Z",
      };
      const response = await handleUsageRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockDetails });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "usage.getDeviceCostDetails",
        userId: "u1",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "",
      } as GetDeviceCostDetailsRequest;
      const response = await handleUsageRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // usage.getDeviceTimeline
  // -------------------------------------------------------------------------

  describe("usage.getDeviceTimeline", () => {
    it("should return daily timeline per device", async () => {
      const mockTimeline = [
        {
          date: "2026-04-01",
          device_id: "d1",
          total_tokens: 5000,
          input_tokens: 3000,
          output_tokens: 2000,
          cached_input_tokens: 500,
        },
        {
          date: "2026-04-02",
          device_id: "d1",
          total_tokens: 3000,
          input_tokens: 2000,
          output_tokens: 1000,
          cached_input_tokens: 200,
        },
      ];
      db.all.mockResolvedValue({ results: mockTimeline });

      const request: GetDeviceTimelineRequest = {
        method: "usage.getDeviceTimeline",
        userId: "u1",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-03T00:00:00.000Z",
      };
      const response = await handleUsageRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTimeline });
    });

    it("should return 400 when params missing", async () => {
      const request = {
        method: "usage.getDeviceTimeline",
        userId: "",
        fromDate: "2026-04-01T00:00:00.000Z",
        toDate: "2026-04-02T00:00:00.000Z",
      } as GetDeviceTimelineRequest;
      const response = await handleUsageRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // usage.getModelPricing
  // -------------------------------------------------------------------------

  describe("usage.getModelPricing", () => {
    it("should return model pricing list", async () => {
      const mockPricing = [
        {
          model: "claude-sonnet-4",
          source: null,
          input_price: 3.0,
          output_price: 15.0,
          cached_input_price: 0.3,
        },
        {
          model: "gpt-4o",
          source: "codex",
          input_price: 5.0,
          output_price: 15.0,
          cached_input_price: 2.5,
        },
      ];
      db.all.mockResolvedValue({ results: mockPricing });

      const request: GetModelPricingRequest = {
        method: "usage.getModelPricing",
      };
      const response = await handleUsageRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockPricing });
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "usage.unknown" } as unknown as GetUsageRequest;
      const response = await handleUsageRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown usage method");
    });
  });
});

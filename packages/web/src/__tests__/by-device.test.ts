import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/usage/by-device/route";
import * as d1Module from "@/lib/d1";

// Mock D1
vi.mock("@/lib/d1", async (importOriginal) => {
  const original = await importOriginal<typeof d1Module>();
  return {
    ...original,
    getD1Client: vi.fn(),
  };
});

// Mock resolveUser
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

// Mock pricing — use real implementations for lookupPricing/estimateCost,
// but mock buildPricingMap to verify DB rows are passed through.
vi.mock("@/lib/pricing", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/pricing")>();
  return {
    ...original,
    buildPricingMap: vi.fn(original.buildPricingMap),
  };
});

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const { buildPricingMap } = (await import("@/lib/pricing")) as unknown as {
  buildPricingMap: ReturnType<typeof vi.fn>;
};

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:7030/api/usage/by-device");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

describe("GET /api/usage/by-device", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client
    );
  });

  describe("authentication", () => {
    it("should reject unauthenticated requests", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await GET(makeRequest());

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
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
      // Summary query
      mockClient.query.mockResolvedValueOnce({
        results: [
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
        ],
        meta: {},
      });
      // Cost detail query
      mockClient.query.mockResolvedValueOnce({
        results: [
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
        ],
        meta: {},
      });
      // Timeline query
      mockClient.query.mockResolvedValueOnce({
        results: [
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
        ],
        meta: {},
      });
      // Pricing DB query (no overrides)
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

      const res = await GET(
        makeRequest({ from: "2026-03-01", to: "2026-03-11" })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.devices).toHaveLength(2);
      expect(body.timeline).toHaveLength(2);
      expect(body.devices[0].device_id).toBe("aaaa-1111");
      expect(body.devices[1].device_id).toBe("bbbb-2222");
    });

    it("should include estimated_cost per device", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
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
        ],
        meta: {},
      });
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            device_id: "aaaa-1111",
            source: "claude-code",
            model: "claude-sonnet-4-20250514",
            input_tokens: 30000,
            output_tokens: 15000,
            cached_input_tokens: 5000,
          },
        ],
        meta: {},
      });
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      // Pricing DB query (no overrides)
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

      const res = await GET(makeRequest({ from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(body.devices[0].estimated_cost).toBeTypeOf("number");
      expect(body.devices[0].estimated_cost).toBeGreaterThan(0);
    });

    it("should join alias from device_aliases", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            device_id: "aaaa-1111",
            alias: "MacBook",
            first_seen: "2026-03-01T00:00:00Z",
            last_seen: "2026-03-10T00:00:00Z",
            total_tokens: 1000,
            input_tokens: 600,
            output_tokens: 300,
            cached_input_tokens: 100,
            reasoning_output_tokens: 0,
            sources: "claude-code",
            models: "claude-sonnet-4-20250514",
          },
          {
            device_id: "bbbb-2222",
            alias: null,
            first_seen: "2026-03-05T00:00:00Z",
            last_seen: "2026-03-10T00:00:00Z",
            total_tokens: 500,
            input_tokens: 300,
            output_tokens: 150,
            cached_input_tokens: 50,
            reasoning_output_tokens: 0,
            sources: "opencode",
            models: "o3",
          },
        ],
        meta: {},
      });
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      // Pricing DB query (no overrides)
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

      const res = await GET(makeRequest({ from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(body.devices[0].alias).toBe("MacBook");
      expect(body.devices[1].alias).toBeNull();
    });

    it("should include device_id = 'default' in results", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            device_id: "default",
            alias: null,
            first_seen: "2026-01-15T00:00:00Z",
            last_seen: "2026-02-28T00:00:00Z",
            total_tokens: 200000,
            input_tokens: 120000,
            output_tokens: 60000,
            cached_input_tokens: 20000,
            reasoning_output_tokens: 0,
            sources: "claude-code",
            models: "claude-sonnet-4-20250514",
          },
        ],
        meta: {},
      });
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            device_id: "default",
            source: "claude-code",
            model: "claude-sonnet-4-20250514",
            input_tokens: 120000,
            output_tokens: 60000,
            cached_input_tokens: 20000,
          },
        ],
        meta: {},
      });
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      // Pricing DB query (no overrides)
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

      const res = await GET(makeRequest({ from: "2026-01-01", to: "2026-03-01" }));
      const body = await res.json();

      expect(body.devices).toHaveLength(1);
      expect(body.devices[0].device_id).toBe("default");
    });

    it("should return sources and models as arrays", async () => {
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            device_id: "aaaa-1111",
            alias: null,
            first_seen: "2026-03-01T00:00:00Z",
            last_seen: "2026-03-10T00:00:00Z",
            total_tokens: 1000,
            input_tokens: 600,
            output_tokens: 300,
            cached_input_tokens: 100,
            reasoning_output_tokens: 0,
            sources: "claude-code,opencode",
            models: "claude-sonnet-4-20250514,o3",
          },
        ],
        meta: {},
      });
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      // Pricing DB query (no overrides)
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });

      const res = await GET(makeRequest({ from: "2026-03-01", to: "2026-03-11" }));
      const body = await res.json();

      expect(Array.isArray(body.devices[0].sources)).toBe(true);
      expect(body.devices[0].sources).toEqual(["claude-code", "opencode"]);
      expect(Array.isArray(body.devices[0].models)).toBe(true);
      expect(body.devices[0].models).toEqual(["claude-sonnet-4-20250514", "o3"]);
    });

    it("should use default date range when params are missing", async () => {
      mockClient.query.mockResolvedValue({ results: [], meta: {} });

      const res = await GET(makeRequest());

      expect(res.status).toBe(200);
      // Should have called query (not returned 400)
      expect(mockClient.query).toHaveBeenCalled();
      const [, params] = mockClient.query.mock.calls[0]!;
      // First param is userId, second is fromDate, third is toDate
      expect(params![0]).toBe("u1");
      expect(typeof params![1]).toBe("string");
      expect(typeof params![2]).toBe("string");
    });

    it("should return 500 on D1 error", async () => {
      mockClient.query.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(makeRequest());

      expect(res.status).toBe(500);
    });

    it("should use DB pricing overrides for estimated_cost", async () => {
      // Summary: one device using a custom-priced model
      mockClient.query.mockResolvedValueOnce({
        results: [
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
        ],
        meta: {},
      });
      // Cost detail
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            device_id: "aaaa-1111",
            source: "claude-code",
            model: "claude-sonnet-4-20250514",
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cached_input_tokens: 0,
          },
        ],
        meta: {},
      });
      // Timeline
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      // Pricing DB query — override claude-sonnet-4 to $100/$200 per 1M
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            id: 1,
            model: "claude-sonnet-4-20250514",
            input: 100,
            output: 200,
            cached: null,
            source: null,
            note: null,
            updated_at: "2026-03-01T00:00:00Z",
            created_at: "2026-03-01T00:00:00Z",
          },
        ],
        meta: {},
      });

      const res = await GET(
        makeRequest({ from: "2026-03-01", to: "2026-03-11" })
      );
      const body = await res.json();

      // With DB override: (1M input * $100/1M) + (1M output * $200/1M) = $300
      // Without override: (1M * $3/1M) + (1M * $15/1M) = $18
      expect(body.devices[0].estimated_cost).toBe(300);

      // Verify buildPricingMap was called with the DB rows
      expect(buildPricingMap).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ model: "claude-sonnet-4-20250514", input: 100, output: 200 }),
        ])
      );
    });

    it("should fall back to static defaults when model_pricing table is missing", async () => {
      // Summary
      mockClient.query.mockResolvedValueOnce({
        results: [
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
        ],
        meta: {},
      });
      // Cost detail
      mockClient.query.mockResolvedValueOnce({
        results: [
          {
            device_id: "aaaa-1111",
            source: "claude-code",
            model: "claude-sonnet-4-20250514",
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cached_input_tokens: 0,
          },
        ],
        meta: {},
      });
      // Timeline
      mockClient.query.mockResolvedValueOnce({ results: [], meta: {} });
      // Pricing DB query — table doesn't exist
      mockClient.query.mockRejectedValueOnce(
        new Error("no such table: model_pricing")
      );

      const res = await GET(
        makeRequest({ from: "2026-03-01", to: "2026-03-11" })
      );
      const body = await res.json();

      // Falls back to static: (1M * $3/1M) + (1M * $15/1M) = $18
      expect(res.status).toBe(200);
      expect(body.devices[0].estimated_cost).toBe(18);
    });
  });
});

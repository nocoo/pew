import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handlePricingRpc,
  type ListModelPricingRequest,
  type GetModelPricingByIdRequest,
  type GetModelPricingByModelSourceRequest,
  type GetDynamicPricingRequest,
  type GetDynamicPricingMetaRequest,
} from "./pricing";
import baseline from "../data/model-prices.json";
import {
  KEY_DYNAMIC,
  KEY_DYNAMIC_META,
} from "../sync/kv-store";
import type { DynamicPricingEntry, DynamicPricingMeta } from "../sync/types";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

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

// ---------------------------------------------------------------------------
// Mock KVNamespace
// ---------------------------------------------------------------------------

function createMockKv() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
}

describe("pricing RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;
  let kv: ReturnType<typeof createMockKv>;

  beforeEach(() => {
    db = createMockDb();
    kv = createMockKv();
  });

  // -------------------------------------------------------------------------
  // pricing.listModelPricing
  // -------------------------------------------------------------------------

  describe("pricing.listModelPricing", () => {
    it("should return all model pricing rows on cache miss", async () => {
      const mockPricing = [
        {
          id: 1,
          model: "gpt-4o",
          input: 2.5,
          output: 10.0,
          cached: 1.25,
          source: "openai",
          note: "Standard pricing",
          updated_at: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          model: "claude-3-opus",
          input: 15.0,
          output: 75.0,
          cached: null,
          source: "anthropic",
          note: null,
          updated_at: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockPricing });

      const request: ListModelPricingRequest = {
        method: "pricing.listModelPricing",
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockPricing, _cached: false });
      expect(kv.get).toHaveBeenCalledWith("pricing:all", "json");
      expect(kv.put).toHaveBeenCalledWith(
        "pricing:all",
        JSON.stringify(mockPricing),
        { expirationTtl: 86400 }
      );
    });

    it("should return cached data on cache hit", async () => {
      const cachedPricing = [
        {
          id: 1,
          model: "gpt-4o",
          input: 2.5,
          output: 10.0,
          cached: 1.25,
          source: "openai",
          note: "Standard pricing",
          updated_at: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      kv.get.mockResolvedValue(cachedPricing);

      const request: ListModelPricingRequest = {
        method: "pricing.listModelPricing",
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: cachedPricing, _cached: true });
      expect(db.all).not.toHaveBeenCalled();
      expect(kv.put).not.toHaveBeenCalled();
    });

    it("should return empty array when no pricing exists", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListModelPricingRequest = {
        method: "pricing.listModelPricing",
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: [], _cached: false });
    });
  });

  // -------------------------------------------------------------------------
  // pricing.getModelPricingById
  // -------------------------------------------------------------------------

  describe("pricing.getModelPricingById", () => {
    it("should return pricing by ID", async () => {
      const mockPricing = {
        id: 1,
        model: "gpt-4o",
        input: 2.5,
        output: 10.0,
        cached: 1.25,
        source: "openai",
        note: "Standard pricing",
        updated_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockPricing);

      const request: GetModelPricingByIdRequest = {
        method: "pricing.getModelPricingById",
        id: 1,
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockPricing });
      expect(db.bind).toHaveBeenCalledWith(1);
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetModelPricingByIdRequest = {
        method: "pricing.getModelPricingById",
        id: 999,
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when id is not a number", async () => {
      const request = {
        method: "pricing.getModelPricingById",
        id: "not-a-number",
      } as unknown as GetModelPricingByIdRequest;
      const response = await handlePricingRpc(request, db, kv);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("id is required");
    });
  });

  // -------------------------------------------------------------------------
  // pricing.getModelPricingByModelSource
  // -------------------------------------------------------------------------

  describe("pricing.getModelPricingByModelSource", () => {
    it("should return pricing by model and source", async () => {
      const mockPricing = {
        id: 1,
        model: "gpt-4o",
        input: 2.5,
        output: 10.0,
        cached: 1.25,
        source: "openai",
        note: "Standard pricing",
        updated_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockPricing);

      const request: GetModelPricingByModelSourceRequest = {
        method: "pricing.getModelPricingByModelSource",
        model: "gpt-4o",
        source: "openai",
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockPricing });
      expect(db.bind).toHaveBeenCalledWith("gpt-4o", "openai", "openai");
    });

    it("should handle null source", async () => {
      const mockPricing = {
        id: 2,
        model: "gpt-4o",
        input: 2.5,
        output: 10.0,
        cached: null,
        source: null,
        note: null,
        updated_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockPricing);

      const request: GetModelPricingByModelSourceRequest = {
        method: "pricing.getModelPricingByModelSource",
        model: "gpt-4o",
        source: null,
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: mockPricing });
      expect(db.bind).toHaveBeenCalledWith("gpt-4o", null, null);
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetModelPricingByModelSourceRequest = {
        method: "pricing.getModelPricingByModelSource",
        model: "nonexistent-model",
        source: null,
      };
      const response = await handlePricingRpc(request, db, kv);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when model is missing", async () => {
      const request = {
        method: "pricing.getModelPricingByModelSource",
        model: "",
        source: null,
      } as GetModelPricingByModelSourceRequest;
      const response = await handlePricingRpc(request, db, kv);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("model is required");
    });
  });

  // -------------------------------------------------------------------------
  // pricing.getDynamicPricing
  // -------------------------------------------------------------------------

  describe("pricing.getDynamicPricing", () => {
    it("returns stored entries with servedFrom='kv' when KV populated", async () => {
      const entries: DynamicPricingEntry[] = [
        {
          model: "anthropic/claude-sonnet-4",
          provider: "Anthropic",
          displayName: null,
          inputPerMillion: 3,
          outputPerMillion: 15,
          cachedPerMillion: 0.3,
          contextWindow: 200000,
          origin: "openrouter",
          updatedAt: "2026-04-30T00:00:00.000Z",
        },
      ];
      kv.get.mockImplementation(async (key: string) => {
        if (key === KEY_DYNAMIC) return entries;
        return null;
      });
      const req: GetDynamicPricingRequest = { method: "pricing.getDynamicPricing" };
      const res = await handlePricingRpc(req, db, kv);
      const body = (await res.json()) as { result: { entries: DynamicPricingEntry[]; servedFrom: string } };
      expect(res.status).toBe(200);
      expect(body.result.servedFrom).toBe("kv");
      expect(body.result.entries).toEqual(entries);
    });

    it("falls back to bundled baseline with servedFrom='baseline' on KV miss", async () => {
      const req: GetDynamicPricingRequest = { method: "pricing.getDynamicPricing" };
      const res = await handlePricingRpc(req, db, kv);
      const body = (await res.json()) as { result: { entries: DynamicPricingEntry[]; servedFrom: string } };
      expect(res.status).toBe(200);
      expect(body.result.servedFrom).toBe("baseline");
      expect(body.result.entries).toEqual(baseline);
    });

    it("falls back to baseline when stored entries array is empty", async () => {
      kv.get.mockImplementation(async (key: string) => {
        if (key === KEY_DYNAMIC) return [];
        return null;
      });
      const req: GetDynamicPricingRequest = { method: "pricing.getDynamicPricing" };
      const res = await handlePricingRpc(req, db, kv);
      const body = (await res.json()) as { result: { servedFrom: string } };
      expect(body.result.servedFrom).toBe("baseline");
    });
  });

  // -------------------------------------------------------------------------
  // pricing.getDynamicPricingMeta
  // -------------------------------------------------------------------------

  describe("pricing.getDynamicPricingMeta", () => {
    it("returns stored meta when KV populated", async () => {
      const meta: DynamicPricingMeta = {
        lastSyncedAt: "2026-04-30T00:00:00.000Z",
        modelCount: 42,
        baselineCount: 14,
        openRouterCount: 20,
        modelsDevCount: 8,
        adminOverrideCount: 0,
        lastErrors: null,
      };
      kv.get.mockImplementation(async (key: string) => {
        if (key === KEY_DYNAMIC_META) return meta;
        return null;
      });
      const req: GetDynamicPricingMetaRequest = { method: "pricing.getDynamicPricingMeta" };
      const res = await handlePricingRpc(req, db, kv);
      const body = (await res.json()) as { result: DynamicPricingMeta };
      expect(body.result).toEqual(meta);
    });

    it("synthesizes cold-start meta on KV miss with kv error in lastErrors", async () => {
      const req: GetDynamicPricingMetaRequest = { method: "pricing.getDynamicPricingMeta" };
      const res = await handlePricingRpc(req, db, kv);
      const body = (await res.json()) as { result: DynamicPricingMeta };
      expect(body.result.lastSyncedAt).toBe("1970-01-01T00:00:00.000Z");
      expect(body.result.baselineCount).toBe((baseline as DynamicPricingEntry[]).length);
      expect(body.result.modelCount).toBe((baseline as DynamicPricingEntry[]).length);
      expect(body.result.lastErrors?.[0]?.source).toBe("kv");
      expect(body.result.lastErrors?.[0]?.message).toContain("cold start");
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "pricing.unknown" } as unknown as ListModelPricingRequest;
      const response = await handlePricingRpc(request, db, kv);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown pricing method");
    });
  });
});

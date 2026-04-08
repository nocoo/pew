import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handlePricingRpc,
  type ListPricingPlansRequest,
  type GetPricingPlanRequest,
  type GetPricingPlanByNameRequest,
  type ListModelPricingRequest,
  type GetModelPricingRequest,
  type ListUsageTiersRequest,
} from "./pricing";
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

describe("pricing RPC handlers", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -------------------------------------------------------------------------
  // pricing.listPlans
  // -------------------------------------------------------------------------

  describe("pricing.listPlans", () => {
    it("should return all pricing plans", async () => {
      const mockPlans = [
        {
          id: "p1",
          name: "Free",
          description: "Free tier",
          price_cents: 0,
          interval: "month",
          features: '["basic"]',
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "p2",
          name: "Pro",
          description: "Pro tier",
          price_cents: 999,
          interval: "month",
          features: '["advanced"]',
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockPlans });

      const request: ListPricingPlansRequest = {
        method: "pricing.listPlans",
      };
      const response = await handlePricingRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockPlans });
    });

    it("should filter active plans only", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListPricingPlansRequest = {
        method: "pricing.listPlans",
        activeOnly: true,
      };
      await handlePricingRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // pricing.getPlan
  // -------------------------------------------------------------------------

  describe("pricing.getPlan", () => {
    it("should return plan by ID", async () => {
      const mockPlan = {
        id: "p1",
        name: "Free",
        description: "Free tier",
        price_cents: 0,
        interval: "month",
        features: '["basic"]',
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockPlan);

      const request: GetPricingPlanRequest = {
        method: "pricing.getPlan",
        planId: "p1",
      };
      const response = await handlePricingRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockPlan });
    });

    it("should return null when not found", async () => {
      db.first.mockResolvedValue(null);

      const request: GetPricingPlanRequest = {
        method: "pricing.getPlan",
        planId: "nonexistent",
      };
      const response = await handlePricingRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: null });
    });

    it("should return 400 when planId missing", async () => {
      const request = {
        method: "pricing.getPlan",
        planId: "",
      } as GetPricingPlanRequest;
      const response = await handlePricingRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // pricing.getPlanByName
  // -------------------------------------------------------------------------

  describe("pricing.getPlanByName", () => {
    it("should return plan by name", async () => {
      const mockPlan = {
        id: "p1",
        name: "Pro",
        description: "Pro tier",
        price_cents: 999,
        interval: "month",
        features: '["advanced"]',
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockPlan);

      const request: GetPricingPlanByNameRequest = {
        method: "pricing.getPlanByName",
        name: "Pro",
      };
      const response = await handlePricingRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockPlan });
    });

    it("should return 400 when name missing", async () => {
      const request = {
        method: "pricing.getPlanByName",
        name: "",
      } as GetPricingPlanByNameRequest;
      const response = await handlePricingRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // pricing.listModelPricing
  // -------------------------------------------------------------------------

  describe("pricing.listModelPricing", () => {
    it("should return all model pricing", async () => {
      const mockPricing = [
        {
          id: "mp1",
          model: "gpt-4",
          input_price_per_million: 30000,
          output_price_per_million: 60000,
          effective_date: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockPricing });

      const request: ListModelPricingRequest = {
        method: "pricing.listModelPricing",
      };
      const response = await handlePricingRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockPricing });
    });

    it("should filter by model", async () => {
      db.all.mockResolvedValue({ results: [] });

      const request: ListModelPricingRequest = {
        method: "pricing.listModelPricing",
        model: "gpt-4",
      };
      await handlePricingRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // pricing.getModelPricing
  // -------------------------------------------------------------------------

  describe("pricing.getModelPricing", () => {
    it("should return model pricing", async () => {
      const mockPricing = {
        id: "mp1",
        model: "gpt-4",
        input_price_per_million: 30000,
        output_price_per_million: 60000,
        effective_date: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      };
      db.first.mockResolvedValue(mockPricing);

      const request: GetModelPricingRequest = {
        method: "pricing.getModelPricing",
        model: "gpt-4",
      };
      const response = await handlePricingRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockPricing });
    });

    it("should filter by effective date", async () => {
      db.first.mockResolvedValue(null);

      const request: GetModelPricingRequest = {
        method: "pricing.getModelPricing",
        model: "gpt-4",
        effectiveDate: "2026-06-01T00:00:00Z",
      };
      await handlePricingRpc(request, db);

      expect(db.prepare).toHaveBeenCalled();
    });

    it("should return 400 when model missing", async () => {
      const request = {
        method: "pricing.getModelPricing",
        model: "",
      } as GetModelPricingRequest;
      const response = await handlePricingRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // pricing.listUsageTiers
  // -------------------------------------------------------------------------

  describe("pricing.listUsageTiers", () => {
    it("should return usage tiers for plan", async () => {
      const mockTiers = [
        {
          id: "ut1",
          plan_id: "p1",
          tier_name: "Tier 1",
          min_tokens: 0,
          max_tokens: 1000000,
          price_per_million: 100,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "ut2",
          plan_id: "p1",
          tier_name: "Tier 2",
          min_tokens: 1000001,
          max_tokens: null,
          price_per_million: 50,
          created_at: "2026-01-01T00:00:00Z",
        },
      ];
      db.all.mockResolvedValue({ results: mockTiers });

      const request: ListUsageTiersRequest = {
        method: "pricing.listUsageTiers",
        planId: "p1",
      };
      const response = await handlePricingRpc(request, db);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ data: mockTiers });
    });

    it("should return 400 when planId missing", async () => {
      const request = {
        method: "pricing.listUsageTiers",
        planId: "",
      } as ListUsageTiersRequest;
      const response = await handlePricingRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "pricing.unknown" } as unknown as ListPricingPlansRequest;
      const response = await handlePricingRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown pricing method");
    });
  });
});

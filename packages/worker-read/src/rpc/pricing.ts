/**
 * Pricing domain RPC handlers for worker-read.
 *
 * Handles pricing-related read queries for model_pricing table.
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { withCache, TTL_24H } from "../cache";

// ---------------------------------------------------------------------------
// Cache Keys
// ---------------------------------------------------------------------------

const CACHE_KEY_PRICING_ALL = "pricing:all";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface ModelPricingRow {
  id: number;
  model: string;
  input: number;
  output: number;
  cached: number | null;
  source: string | null;
  note: string | null;
  updated_at: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListModelPricingRequest {
  method: "pricing.listModelPricing";
}

export interface GetModelPricingByIdRequest {
  method: "pricing.getModelPricingById";
  id: number;
}

export interface GetModelPricingByModelSourceRequest {
  method: "pricing.getModelPricingByModelSource";
  model: string;
  source: string | null;
}

export type PricingRpcRequest =
  | ListModelPricingRequest
  | GetModelPricingByIdRequest
  | GetModelPricingByModelSourceRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListModelPricing(
  _req: ListModelPricingRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  const { data, cached } = await withCache(
    kv,
    CACHE_KEY_PRICING_ALL,
    async () => {
      const results = await db
        .prepare("SELECT * FROM model_pricing ORDER BY model ASC, source ASC")
        .all<ModelPricingRow>();
      return results.results;
    },
    { ttlSeconds: TTL_24H }
  );

  return Response.json({ result: data, _cached: cached });
}

async function handleGetModelPricingById(
  req: GetModelPricingByIdRequest,
  db: D1Database
): Promise<Response> {
  if (typeof req.id !== "number") {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const result = await db
    .prepare("SELECT * FROM model_pricing WHERE id = ?")
    .bind(req.id)
    .first<ModelPricingRow>();

  return Response.json({ result: result });
}

async function handleGetModelPricingByModelSource(
  req: GetModelPricingByModelSourceRequest,
  db: D1Database
): Promise<Response> {
  if (!req.model) {
    return Response.json({ error: "model is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      "SELECT * FROM model_pricing WHERE model = ? AND (source = ? OR (source IS NULL AND ? IS NULL))"
    )
    .bind(req.model, req.source, req.source)
    .first<ModelPricingRow>();

  return Response.json({ result: result });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handlePricingRpc(
  request: PricingRpcRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  switch (request.method) {
    case "pricing.listModelPricing":
      return handleListModelPricing(request, db, kv);
    case "pricing.getModelPricingById":
      return handleGetModelPricingById(request, db);
    case "pricing.getModelPricingByModelSource":
      return handleGetModelPricingByModelSource(request, db);
    default:
      return Response.json(
        { error: `Unknown pricing method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

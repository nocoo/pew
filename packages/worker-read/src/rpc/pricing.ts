/**
 * Pricing domain RPC handlers for worker-read.
 *
 * Handles pricing-related read queries for model_pricing table.
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { withCache, TTL_24H } from "../cache";
import baseline from "../data/model-prices.json";
import { readDynamic, readMeta } from "../sync/kv-store";
import { syncDynamicPricing, type SyncOutcome } from "../sync/orchestrator";
import type { DynamicPricingEntry, DynamicPricingMeta } from "../sync/types";

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

export interface GetDynamicPricingRequest {
  method: "pricing.getDynamicPricing";
}

export interface GetDynamicPricingMetaRequest {
  method: "pricing.getDynamicPricingMeta";
}

export interface RebuildDynamicPricingRequest {
  method: "pricing.rebuildDynamicPricing";
  forceRefetch?: boolean;
}

export type PricingRpcRequest =
  | ListModelPricingRequest
  | GetModelPricingByIdRequest
  | GetModelPricingByModelSourceRequest
  | GetDynamicPricingRequest
  | GetDynamicPricingMetaRequest
  | RebuildDynamicPricingRequest;

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

const BASELINE_ENTRIES = baseline as DynamicPricingEntry[];

async function handleGetDynamicPricing(kv: KVNamespace): Promise<Response> {
  const stored = await readDynamic(kv);
  if (stored && stored.length > 0) {
    return Response.json({ result: { entries: stored, servedFrom: "kv" } });
  }
  return Response.json({
    result: { entries: BASELINE_ENTRIES, servedFrom: "baseline" },
  });
}

async function handleGetDynamicPricingMeta(kv: KVNamespace): Promise<Response> {
  const stored = await readMeta(kv);
  if (stored) {
    return Response.json({ result: stored });
  }
  const synthesized: DynamicPricingMeta = {
    lastSyncedAt: "1970-01-01T00:00:00.000Z",
    modelCount: BASELINE_ENTRIES.length,
    baselineCount: BASELINE_ENTRIES.length,
    openRouterCount: 0,
    modelsDevCount: 0,
    adminOverrideCount: 0,
    lastErrors: [
      {
        source: "kv",
        at: new Date().toISOString(),
        message: "KV empty (cold start)",
      },
    ],
  };
  return Response.json({ result: synthesized });
}

async function handleRebuildDynamicPricing(
  req: RebuildDynamicPricingRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  const outcome: SyncOutcome = await syncDynamicPricing(
    { db, kv },
    new Date().toISOString(),
    { forceRefetch: req.forceRefetch }
  );
  return Response.json({ result: outcome });
}

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
    case "pricing.getDynamicPricing":
      return handleGetDynamicPricing(kv);
    case "pricing.getDynamicPricingMeta":
      return handleGetDynamicPricingMeta(kv);
    case "pricing.rebuildDynamicPricing":
      return handleRebuildDynamicPricing(request, db, kv);
    default:
      return Response.json(
        { error: `Unknown pricing method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

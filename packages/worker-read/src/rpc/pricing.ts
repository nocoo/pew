/**
 * Pricing domain RPC handlers for worker-read.
 *
 * Handles pricing-related read queries (plans, model pricing, usage tiers).
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface PricingPlanRow {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  interval: string;
  features: string;
  is_active: boolean;
  created_at: string;
}

export interface ModelPricingRow {
  id: string;
  model: string;
  input_price_per_million: number;
  output_price_per_million: number;
  effective_date: string;
  created_at: string;
}

export interface UsageTierRow {
  id: string;
  plan_id: string;
  tier_name: string;
  min_tokens: number;
  max_tokens: number | null;
  price_per_million: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListPricingPlansRequest {
  method: "pricing.listPlans";
  activeOnly?: boolean;
}

export interface GetPricingPlanRequest {
  method: "pricing.getPlan";
  planId: string;
}

export interface GetPricingPlanByNameRequest {
  method: "pricing.getPlanByName";
  name: string;
}

export interface ListModelPricingRequest {
  method: "pricing.listModelPricing";
  model?: string;
}

export interface GetModelPricingRequest {
  method: "pricing.getModelPricing";
  model: string;
  effectiveDate?: string;
}

export interface ListUsageTiersRequest {
  method: "pricing.listUsageTiers";
  planId: string;
}

export type PricingRpcRequest =
  | ListPricingPlansRequest
  | GetPricingPlanRequest
  | GetPricingPlanByNameRequest
  | ListModelPricingRequest
  | GetModelPricingRequest
  | ListUsageTiersRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListPricingPlans(
  req: ListPricingPlansRequest,
  db: D1Database
): Promise<Response> {
  let sql = `SELECT id, name, description, price_cents, interval, features, is_active, created_at
             FROM pricing_plans`;

  if (req.activeOnly) {
    sql += ` WHERE is_active = 1`;
  }

  sql += ` ORDER BY price_cents ASC`;

  const results = await db.prepare(sql).all<PricingPlanRow>();

  return Response.json({ data: results.results });
}

async function handleGetPricingPlan(
  req: GetPricingPlanRequest,
  db: D1Database
): Promise<Response> {
  if (!req.planId) {
    return Response.json({ error: "planId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id, name, description, price_cents, interval, features, is_active, created_at
       FROM pricing_plans
       WHERE id = ?`
    )
    .bind(req.planId)
    .first<PricingPlanRow>();

  return Response.json({ data: result });
}

async function handleGetPricingPlanByName(
  req: GetPricingPlanByNameRequest,
  db: D1Database
): Promise<Response> {
  if (!req.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id, name, description, price_cents, interval, features, is_active, created_at
       FROM pricing_plans
       WHERE name = ?`
    )
    .bind(req.name)
    .first<PricingPlanRow>();

  return Response.json({ data: result });
}

async function handleListModelPricing(
  req: ListModelPricingRequest,
  db: D1Database
): Promise<Response> {
  let sql = `SELECT id, model, input_price_per_million, output_price_per_million, effective_date, created_at
             FROM model_pricing`;
  const params: unknown[] = [];

  if (req.model) {
    sql += ` WHERE model = ?`;
    params.push(req.model);
  }

  sql += ` ORDER BY effective_date DESC`;

  const results =
    params.length > 0
      ? await db.prepare(sql).bind(...params).all<ModelPricingRow>()
      : await db.prepare(sql).all<ModelPricingRow>();

  return Response.json({ data: results.results });
}

async function handleGetModelPricing(
  req: GetModelPricingRequest,
  db: D1Database
): Promise<Response> {
  if (!req.model) {
    return Response.json({ error: "model is required" }, { status: 400 });
  }

  let sql = `SELECT id, model, input_price_per_million, output_price_per_million, effective_date, created_at
             FROM model_pricing
             WHERE model = ?`;
  const params: unknown[] = [req.model];

  if (req.effectiveDate) {
    sql += ` AND effective_date <= ?`;
    params.push(req.effectiveDate);
  }

  sql += ` ORDER BY effective_date DESC LIMIT 1`;

  const result = await db.prepare(sql).bind(...params).first<ModelPricingRow>();

  return Response.json({ data: result });
}

async function handleListUsageTiers(
  req: ListUsageTiersRequest,
  db: D1Database
): Promise<Response> {
  if (!req.planId) {
    return Response.json({ error: "planId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT id, plan_id, tier_name, min_tokens, max_tokens, price_per_million, created_at
       FROM usage_tiers
       WHERE plan_id = ?
       ORDER BY min_tokens ASC`
    )
    .bind(req.planId)
    .all<UsageTierRow>();

  return Response.json({ data: results.results });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handlePricingRpc(
  request: PricingRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "pricing.listPlans":
      return handleListPricingPlans(request, db);
    case "pricing.getPlan":
      return handleGetPricingPlan(request, db);
    case "pricing.getPlanByName":
      return handleGetPricingPlanByName(request, db);
    case "pricing.listModelPricing":
      return handleListModelPricing(request, db);
    case "pricing.getModelPricing":
      return handleGetModelPricing(request, db);
    case "pricing.listUsageTiers":
      return handleListUsageTiers(request, db);
    default:
      return Response.json(
        { error: `Unknown pricing method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

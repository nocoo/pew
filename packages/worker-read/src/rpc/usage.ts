/**
 * Usage domain RPC handlers for worker-read.
 *
 * Handles all usage-related read queries with typed interfaces.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface UsageRow {
  source: string;
  model: string;
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export interface DeviceSummaryRow {
  device_id: string;
  alias: string | null;
  first_seen: string;
  last_seen: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  sources: string;
  models: string;
}

export interface CostDetailRow {
  device_id: string;
  source: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface TimelineRow {
  date: string;
  device_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface PricingRow {
  model: string;
  source: string | null;
  input_price: number;
  output_price: number;
  cached_input_price: number | null;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetUsageRequest {
  method: "usage.get";
  userId: string;
  fromDate: string;
  toDate: string;
  source?: string;
  granularity?: "half-hour" | "day";
}

export interface GetDeviceSummaryRequest {
  method: "usage.getDeviceSummary";
  userId: string;
  fromDate: string;
  toDate: string;
}

export interface GetDeviceCostDetailsRequest {
  method: "usage.getDeviceCostDetails";
  userId: string;
  fromDate: string;
  toDate: string;
}

export interface GetDeviceTimelineRequest {
  method: "usage.getDeviceTimeline";
  userId: string;
  fromDate: string;
  toDate: string;
}

export interface GetModelPricingRequest {
  method: "usage.getModelPricing";
}

export type UsageRpcRequest =
  | GetUsageRequest
  | GetDeviceSummaryRequest
  | GetDeviceCostDetailsRequest
  | GetDeviceTimelineRequest
  | GetModelPricingRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetUsage(
  req: GetUsageRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "userId, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const granularity = req.granularity ?? "half-hour";
  const timeColumn =
    granularity === "day" ? "date(hour_start) AS hour_start" : "hour_start";
  const groupBy =
    granularity === "day"
      ? "date(hour_start), source, model"
      : "hour_start, source, model";

  const conditions = ["user_id = ?", "hour_start >= ?", "hour_start < ?"];
  const params: unknown[] = [req.userId, req.fromDate, req.toDate];

  if (req.source) {
    conditions.push("source = ?");
    params.push(req.source);
  }

  const sql = `
    SELECT
      source,
      model,
      ${timeColumn},
      SUM(input_tokens) AS input_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(reasoning_output_tokens) AS reasoning_output_tokens,
      SUM(total_tokens) AS total_tokens
    FROM usage_records
    WHERE ${conditions.join(" AND ")}
    GROUP BY ${groupBy}
    ORDER BY hour_start ASC, source, model
  `;

  const stmt = db.prepare(sql);
  const results = await stmt.bind(...params).all<UsageRow>();

  return Response.json({ data: results.results });
}

async function handleGetDeviceSummary(
  req: GetDeviceSummaryRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "userId, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const results = await db
    .prepare(
      `SELECT
        ur.device_id,
        da.alias,
        MIN(ur.hour_start) AS first_seen,
        MAX(ur.hour_start) AS last_seen,
        SUM(ur.total_tokens) AS total_tokens,
        SUM(ur.input_tokens) AS input_tokens,
        SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens,
        SUM(ur.reasoning_output_tokens) AS reasoning_output_tokens,
        GROUP_CONCAT(DISTINCT ur.source) AS sources,
        GROUP_CONCAT(DISTINCT ur.model) AS models
      FROM usage_records ur
      LEFT JOIN device_aliases da
        ON da.user_id = ur.user_id AND da.device_id = ur.device_id
      WHERE ur.user_id = ?
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      GROUP BY ur.device_id
      ORDER BY total_tokens DESC`
    )
    .bind(req.userId, req.fromDate, req.toDate)
    .all<DeviceSummaryRow>();

  return Response.json({ data: results.results });
}

async function handleGetDeviceCostDetails(
  req: GetDeviceCostDetailsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "userId, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const results = await db
    .prepare(
      `SELECT
        ur.device_id,
        ur.source,
        ur.model,
        SUM(ur.input_tokens) AS input_tokens,
        SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens
      FROM usage_records ur
      WHERE ur.user_id = ?
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      GROUP BY ur.device_id, ur.source, ur.model`
    )
    .bind(req.userId, req.fromDate, req.toDate)
    .all<CostDetailRow>();

  return Response.json({ data: results.results });
}

async function handleGetDeviceTimeline(
  req: GetDeviceTimelineRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "userId, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const results = await db
    .prepare(
      `SELECT
        date(ur.hour_start) AS date,
        ur.device_id,
        SUM(ur.total_tokens) AS total_tokens,
        SUM(ur.input_tokens) AS input_tokens,
        SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens
      FROM usage_records ur
      WHERE ur.user_id = ?
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      GROUP BY date(ur.hour_start), ur.device_id
      ORDER BY date ASC`
    )
    .bind(req.userId, req.fromDate, req.toDate)
    .all<TimelineRow>();

  return Response.json({ data: results.results });
}

async function handleGetModelPricing(db: D1Database): Promise<Response> {
  const results = await db
    .prepare("SELECT * FROM model_pricing ORDER BY model ASC")
    .all<PricingRow>();

  return Response.json({ data: results.results });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleUsageRpc(
  request: UsageRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "usage.get":
      return handleGetUsage(request, db);
    case "usage.getDeviceSummary":
      return handleGetDeviceSummary(request, db);
    case "usage.getDeviceCostDetails":
      return handleGetDeviceCostDetails(request, db);
    case "usage.getDeviceTimeline":
      return handleGetDeviceTimeline(request, db);
    case "usage.getModelPricing":
      return handleGetModelPricing(db);
    default:
      return Response.json(
        { error: `Unknown usage method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

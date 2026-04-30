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

// ---------------------------------------------------------------------------

export interface GetUsageRequest {
  method: "usage.get";
  userId: string;
  fromDate: string;
  toDate: string;
  source?: string;
  deviceId?: string;
  granularity?: "half-hour" | "day";
  tzOffset?: number;
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
  granularity?: "half-hour" | "day";
  tzOffset?: number;
}

export type UsageRpcRequest =
  | GetUsageRequest
  | GetDeviceSummaryRequest
  | GetDeviceCostDetailsRequest
  | GetDeviceTimelineRequest;

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
  const rawTz = req.tzOffset ?? 0;
  const tzOffset =
    Number.isFinite(rawTz) && Math.abs(rawTz) <= 840 ? rawTz : 0;

  let timeColumn: string;
  let groupBy: string;
  const prependParams: unknown[] = [];

  if (granularity === "day") {
    if (tzOffset !== 0) {
      const offsetStr = String(-tzOffset);
      // Note: GROUP BY doesn't support parameterized ?, so we inline the offset
      // The offset is validated (integer, abs <= 840) so this is safe
      timeColumn =
        "date(datetime(hour_start, ? || ' minutes')) AS hour_start";
      groupBy =
        `date(datetime(hour_start, '${offsetStr} minutes')), source, model`;
      prependParams.push(offsetStr);
    } else {
      timeColumn = "date(hour_start) AS hour_start";
      groupBy = "date(hour_start), source, model";
    }
  } else {
    timeColumn = "hour_start";
    groupBy = "hour_start, source, model";
  }

  const conditions = ["user_id = ?", "hour_start >= ?", "hour_start < ?"];
  const params: unknown[] = [req.userId, req.fromDate, req.toDate];

  if (req.source) {
    conditions.push("source = ?");
    params.push(req.source);
  }

  if (req.deviceId) {
    conditions.push("device_id = ?");
    params.push(req.deviceId);
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
  const results = await stmt
    .bind(...prependParams, ...params)
    .all<UsageRow>();

  return Response.json({ result: results.results });
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

  return Response.json({ result: results.results });
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

  return Response.json({ result: results.results });
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

  const granularity = req.granularity ?? "day";
  const rawTz = req.tzOffset ?? 0;
  const tzOffset =
    Number.isFinite(rawTz) && Math.abs(rawTz) <= 840 ? rawTz : 0;

  let dateExpr: string;
  let groupBy: string;
  const tzParams: unknown[] = [];

  if (granularity === "day") {
    if (tzOffset !== 0) {
      const offsetStr = String(-tzOffset);
      // Note: GROUP BY doesn't support parameterized ?, so we inline the offset
      // The offset is validated (integer, abs <= 840) so this is safe
      dateExpr = "date(datetime(ur.hour_start, ? || ' minutes'))";
      groupBy = `date(datetime(ur.hour_start, '${offsetStr} minutes')), ur.device_id`;
      tzParams.push(offsetStr);
    } else {
      dateExpr = "date(ur.hour_start)";
      groupBy = "date(ur.hour_start), ur.device_id";
    }
  } else {
    dateExpr = "ur.hour_start";
    groupBy = "ur.hour_start, ur.device_id";
  }

  const sql = `
    SELECT
      ${dateExpr} AS date,
      ur.device_id,
      SUM(ur.total_tokens) AS total_tokens,
      SUM(ur.input_tokens) AS input_tokens,
      SUM(ur.output_tokens) AS output_tokens,
      SUM(ur.cached_input_tokens) AS cached_input_tokens
    FROM usage_records ur
    WHERE ur.user_id = ?
      AND ur.hour_start >= ?
      AND ur.hour_start < ?
    GROUP BY ${groupBy}
    ORDER BY date ASC
  `;

  const results = await db
    .prepare(sql)
    .bind(...tzParams, req.userId, req.fromDate, req.toDate)
    .all<TimelineRow>();

  return Response.json({ result: results.results });
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
    default:
      return Response.json(
        { error: `Unknown usage method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

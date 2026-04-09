/**
 * Live domain RPC handlers for worker-read.
 *
 * Handles live/real-time data queries (active sessions, recent activity, live stats).
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface ActiveSessionRow {
  id: string;
  user_id: string;
  name: string | null;
  source: string;
  started_at: string;
  total_messages: number;
  last_activity_at: string;
}

export interface RecentActivityRow {
  id: string;
  user_id: string;
  name: string | null;
  source: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

export interface LiveStatsRow {
  active_sessions: number;
  tokens_last_hour: number;
  requests_last_hour: number;
  unique_users_last_hour: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetActiveSessionsRequest {
  method: "live.getActiveSessions";
  limit?: number;
}

export interface GetRecentActivityRequest {
  method: "live.getRecentActivity";
  userId?: string;
  source?: string;
  limit?: number;
}

export interface GetLiveStatsRequest {
  method: "live.getStats";
}

export interface GetUserLiveStatsRequest {
  method: "live.getUserStats";
  userId: string;
}

export interface PingRequest {
  method: "live.ping";
}

export type LiveRpcRequest =
  | GetActiveSessionsRequest
  | GetRecentActivityRequest
  | GetLiveStatsRequest
  | GetUserLiveStatsRequest
  | PingRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetActiveSessions(
  req: GetActiveSessionsRequest,
  db: D1Database
): Promise<Response> {
  const limit = Math.min(req.limit ?? 50, 250);

  // session_records has last_message_at instead of ended_at
  // "Active" sessions are those with recent activity (within 30 min)
  const sql = `
    SELECT
      sr.id,
      sr.user_id,
      u.name,
      sr.source,
      sr.started_at,
      sr.total_messages,
      sr.last_message_at AS last_activity_at
    FROM session_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.last_message_at >= datetime('now', '-30 minutes')
    ORDER BY sr.last_message_at DESC
    LIMIT ?
  `;

  const results = await db.prepare(sql).bind(limit).all<ActiveSessionRow>();

  return Response.json({ result: results.results });
}

async function handleGetRecentActivity(
  req: GetRecentActivityRequest,
  db: D1Database
): Promise<Response> {
  const limit = Math.min(req.limit ?? 50, 250);
  const conditions = ["ur.hour_start >= datetime('now', '-1 hour')"];
  const params: unknown[] = [];

  if (req.userId) {
    conditions.push("ur.user_id = ?");
    params.push(req.userId);
  }

  if (req.source) {
    conditions.push("ur.source = ?");
    params.push(req.source);
  }

  const sql = `
    SELECT
      ur.id,
      ur.user_id,
      u.name,
      ur.source,
      ur.model,
      ur.input_tokens,
      ur.output_tokens,
      ur.hour_start AS created_at
    FROM usage_records ur
    JOIN users u ON u.id = ur.user_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY ur.hour_start DESC
    LIMIT ?
  `;

  params.push(limit);

  const results = await db.prepare(sql).bind(...params).all<RecentActivityRow>();

  return Response.json({ result: results.results });
}

async function handleGetLiveStats(db: D1Database): Promise<Response> {
  // session_records uses last_message_at instead of ended_at
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM session_records WHERE last_message_at >= datetime('now', '-30 minutes')) AS active_sessions,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM usage_records WHERE hour_start >= datetime('now', '-1 hour')) AS tokens_last_hour,
      (SELECT COUNT(*) FROM usage_records WHERE hour_start >= datetime('now', '-1 hour')) AS requests_last_hour,
      (SELECT COUNT(DISTINCT user_id) FROM usage_records WHERE hour_start >= datetime('now', '-1 hour')) AS unique_users_last_hour
  `;

  const result = await db.prepare(sql).first<LiveStatsRow>();

  return Response.json({ result: result });
}

async function handleGetUserLiveStats(
  req: GetUserLiveStatsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  // session_records uses last_message_at instead of ended_at
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM session_records WHERE user_id = ? AND last_message_at >= datetime('now', '-30 minutes')) AS active_sessions,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM usage_records WHERE user_id = ? AND hour_start >= datetime('now', '-1 hour')) AS tokens_last_hour,
      (SELECT COUNT(*) FROM usage_records WHERE user_id = ? AND hour_start >= datetime('now', '-1 hour')) AS requests_last_hour
  `;

  const result = await db
    .prepare(sql)
    .bind(req.userId, req.userId, req.userId)
    .first<{
      active_sessions: number;
      tokens_last_hour: number;
      requests_last_hour: number;
    }>();

  return Response.json({ result: result });
}

async function handlePing(db: D1Database): Promise<Response> {
  await db.prepare("SELECT 1").first();
  return Response.json({ result: { ok: true } });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleLiveRpc(
  request: LiveRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "live.getActiveSessions":
      return handleGetActiveSessions(request, db);
    case "live.getRecentActivity":
      return handleGetRecentActivity(request, db);
    case "live.getStats":
      return handleGetLiveStats(db);
    case "live.getUserStats":
      return handleGetUserLiveStats(request, db);
    case "live.ping":
      return handlePing(db);
    default:
      return Response.json(
        { error: `Unknown live method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

/**
 * Achievements domain RPC handlers for worker-read.
 *
 * Handles all achievement-related read queries with typed interfaces.
 * Earners/count queries are cached in KV for 5 minutes (global data, changes slowly).
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { withCache, TTL_5M } from "../cache";

// ---------------------------------------------------------------------------
// Cache Keys
// ---------------------------------------------------------------------------

/**
 * Cache key for achievement earners (top N users who earned an achievement).
 * These are global aggregates — same result for all viewers.
 */
function cacheKeyEarners(achievementId: string, limit: number, offset: number): string {
  return `ach:${achievementId}:earners:${limit}:${offset}`;
}

/**
 * Cache key for achievement earners count.
 */
function cacheKeyEarnersCount(achievementId: string): string {
  return `ach:${achievementId}:count`;
}

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface UsageAggregatesRow {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
}

export interface DailyUsageRow {
  day: string;
  total_tokens: number;
}

export interface DailyCostRow {
  day: string;
  model: string;
  source: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface DiversityRow {
  source_count: number;
  model_count: number;
  device_count: number;
}

export interface SessionAggregatesRow {
  total_sessions: number;
  quick_sessions: number;
  marathon_sessions: number;
  max_messages: number;
  automated_sessions: number;
}

export interface HourlyUsageRow {
  hour_start: string;
  total_tokens: number;
}

export interface CostByModelSourceRow {
  model: string;
  source: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface AchievementEarnerRow {
  id: string;
  name: string | null;
  image: string | null;
  slug: string | null;
  value: number;
  earned_at: string | null;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetUsageAggregatesRequest {
  method: "achievements.getUsageAggregates";
  userId: string;
}

export interface GetDailyUsageRequest {
  method: "achievements.getDailyUsage";
  userId: string;
}

export interface GetDailyCostBreakdownRequest {
  method: "achievements.getDailyCostBreakdown";
  userId: string;
}

export interface GetDiversityCountsRequest {
  method: "achievements.getDiversityCounts";
  userId: string;
}

export interface GetSessionAggregatesRequest {
  method: "achievements.getSessionAggregates";
  userId: string;
}

export interface GetHourlyUsageRequest {
  method: "achievements.getHourlyUsage";
  userId: string;
}

export interface GetCostByModelSourceRequest {
  method: "achievements.getCostByModelSource";
  userId: string;
}

export interface GetAchievementEarnersRequest {
  method: "achievements.getEarners";
  achievementId: string;
  sql: string;
  params: unknown[];
}

export interface GetAchievementEarnersCountRequest {
  method: "achievements.getEarnersCount";
  achievementId: string;
  sql: string;
  params: unknown[];
}

export type AchievementsRpcRequest =
  | GetUsageAggregatesRequest
  | GetDailyUsageRequest
  | GetDailyCostBreakdownRequest
  | GetDiversityCountsRequest
  | GetSessionAggregatesRequest
  | GetHourlyUsageRequest
  | GetCostByModelSourceRequest
  | GetAchievementEarnersRequest
  | GetAchievementEarnersCountRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetUsageAggregates(
  req: GetUsageAggregatesRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS reasoning_output_tokens
      FROM usage_records
      WHERE user_id = ?`
    )
    .bind(req.userId)
    .first<UsageAggregatesRow>();

  return Response.json({ result: result });
}

async function handleGetDailyUsage(
  req: GetDailyUsageRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT DATE(hour_start) AS day, SUM(total_tokens) AS total_tokens
       FROM usage_records
       WHERE user_id = ?
       GROUP BY DATE(hour_start)
       ORDER BY day`
    )
    .bind(req.userId)
    .all<DailyUsageRow>();

  return Response.json({ result: results.results });
}

async function handleGetDailyCostBreakdown(
  req: GetDailyCostBreakdownRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT DATE(hour_start) AS day, model, source,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens
       FROM usage_records
       WHERE user_id = ?
       GROUP BY DATE(hour_start), model, source`
    )
    .bind(req.userId)
    .all<DailyCostRow>();

  return Response.json({ result: results.results });
}

async function handleGetDiversityCounts(
  req: GetDiversityCountsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT
        COUNT(DISTINCT source) AS source_count,
        COUNT(DISTINCT model) AS model_count,
        COUNT(DISTINCT device_id) AS device_count
      FROM usage_records
      WHERE user_id = ?`
    )
    .bind(req.userId)
    .first<DiversityRow>();

  return Response.json({ result: result });
}

async function handleGetSessionAggregates(
  req: GetSessionAggregatesRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT
        COUNT(*) AS total_sessions,
        SUM(CASE WHEN duration_seconds < 300 THEN 1 ELSE 0 END) AS quick_sessions,
        SUM(CASE WHEN duration_seconds > 7200 THEN 1 ELSE 0 END) AS marathon_sessions,
        MAX(total_messages) AS max_messages,
        SUM(CASE WHEN kind = 'automated' THEN 1 ELSE 0 END) AS automated_sessions
      FROM session_records
      WHERE user_id = ?`
    )
    .bind(req.userId)
    .first<SessionAggregatesRow>();

  return Response.json({ result: result });
}

async function handleGetHourlyUsage(
  req: GetHourlyUsageRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT hour_start, SUM(total_tokens) AS total_tokens
       FROM usage_records
       WHERE user_id = ?
       GROUP BY hour_start`
    )
    .bind(req.userId)
    .all<HourlyUsageRow>();

  return Response.json({ result: results.results });
}

async function handleGetCostByModelSource(
  req: GetCostByModelSourceRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT model, source,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens
       FROM usage_records
       WHERE user_id = ?
       GROUP BY model, source`
    )
    .bind(req.userId)
    .all<CostByModelSourceRow>();

  return Response.json({ result: results.results });
}

async function handleGetAchievementEarners(
  req: GetAchievementEarnersRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  if (!req.achievementId || !req.sql || !req.params) {
    return Response.json(
      { error: "achievementId, sql, and params are required" },
      { status: 400 }
    );
  }

  // Extract limit and offset from params for cache key
  // Convention: params = [threshold, limit, offset]
  const limit = typeof req.params[1] === "number" ? req.params[1] : 5;
  const offset = typeof req.params[2] === "number" ? req.params[2] : 0;
  const cacheKey = cacheKeyEarners(req.achievementId, limit, offset);

  const { data, cached } = await withCache(
    kv,
    cacheKey,
    async () => {
      const results = await db
        .prepare(req.sql)
        .bind(...req.params)
        .all<AchievementEarnerRow>();
      return results.results;
    },
    { ttlSeconds: TTL_5M }
  );

  return Response.json({ result: data, _cached: cached });
}

async function handleGetAchievementEarnersCount(
  req: GetAchievementEarnersCountRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  if (!req.achievementId || !req.sql || !req.params) {
    return Response.json(
      { error: "achievementId, sql, and params are required" },
      { status: 400 }
    );
  }

  const cacheKey = cacheKeyEarnersCount(req.achievementId);

  const { data, cached } = await withCache(
    kv,
    cacheKey,
    async () => {
      const result = await db
        .prepare(req.sql)
        .bind(...req.params)
        .first<{ count: number }>();
      return result?.count ?? 0;
    },
    { ttlSeconds: TTL_5M }
  );

  return Response.json({ result: data, _cached: cached });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleAchievementsRpc(
  request: AchievementsRpcRequest,
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  switch (request.method) {
    case "achievements.getUsageAggregates":
      return handleGetUsageAggregates(request, db);
    case "achievements.getDailyUsage":
      return handleGetDailyUsage(request, db);
    case "achievements.getDailyCostBreakdown":
      return handleGetDailyCostBreakdown(request, db);
    case "achievements.getDiversityCounts":
      return handleGetDiversityCounts(request, db);
    case "achievements.getSessionAggregates":
      return handleGetSessionAggregates(request, db);
    case "achievements.getHourlyUsage":
      return handleGetHourlyUsage(request, db);
    case "achievements.getCostByModelSource":
      return handleGetCostByModelSource(request, db);
    case "achievements.getEarners":
      return handleGetAchievementEarners(request, db, kv);
    case "achievements.getEarnersCount":
      return handleGetAchievementEarnersCount(request, db, kv);
    default:
      return Response.json(
        { error: `Unknown achievements method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

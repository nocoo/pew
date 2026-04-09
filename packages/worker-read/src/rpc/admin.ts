/**
 * Admin domain RPC handlers for worker-read.
 *
 * Handles admin-related read queries (audit logs, system stats, user management).
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SystemStatsRow {
  total_users: number;
  total_sessions: number;
  total_tokens: number;
  active_users_24h: number;
}

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  created_at: string;
}

/** Per-user storage stats row */
export interface StorageUserRow {
  user_id: string;
  slug: string | null;
  email: string | null;
  name: string | null;
  image: string | null;
  team_count: number;
  device_count: number;
  total_tokens: number;
  tokens_7d: number;
  tokens_30d: number;
  usage_row_count: number;
  session_count: number;
  total_messages: number;
  total_duration_seconds: number;
  first_seen: string | null;
  last_seen: string | null;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListAuditLogsRequest {
  method: "admin.listAuditLogs";
  userId?: string;
  action?: string;
  resourceType?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface GetAuditLogRequest {
  method: "admin.getAuditLog";
  logId: string;
}

export interface GetSystemStatsRequest {
  method: "admin.getSystemStats";
}

export interface ListAdminUsersRequest {
  method: "admin.listUsers";
  query?: string;
  limit?: number;
  offset?: number;
}

export interface GetAdminUserRequest {
  method: "admin.getUser";
  userId: string;
}

export interface CountUsersRequest {
  method: "admin.countUsers";
}

export interface GetStorageStatsRequest {
  method: "admin.getStorageStats";
}

export type AdminRpcRequest =
  | ListAuditLogsRequest
  | GetAuditLogRequest
  | GetSystemStatsRequest
  | ListAdminUsersRequest
  | GetAdminUserRequest
  | CountUsersRequest
  | GetStorageStatsRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListAuditLogs(
  _req: ListAuditLogsRequest,
  _db: D1Database
): Promise<Response> {
  // audit_logs table does not exist in the current schema
  // Return empty results until the table is created via migration
  return Response.json({ result: [] });
}

async function handleGetAuditLog(
  req: GetAuditLogRequest,
  _db: D1Database
): Promise<Response> {
  if (!req.logId) {
    return Response.json({ error: "logId is required" }, { status: 400 });
  }

  // audit_logs table does not exist in the current schema
  return Response.json({ result: null });
}

async function handleGetSystemStats(db: D1Database): Promise<Response> {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM session_records) AS total_sessions,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM usage_records) AS total_tokens,
      (SELECT COUNT(DISTINCT user_id) FROM session_records WHERE started_at >= datetime('now', '-1 day')) AS active_users_24h
  `;

  const result = await db.prepare(sql).first<SystemStatsRow>();

  return Response.json({ result: result });
}

async function handleListAdminUsers(
  req: ListAdminUsersRequest,
  db: D1Database
): Promise<Response> {
  const limit = Math.min(req.limit ?? 50, 250);
  const offset = req.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.query) {
    conditions.push("(name LIKE ? OR email LIKE ?)");
    const pattern = `%${req.query}%`;
    params.push(pattern, pattern);
  }

  let sql = `SELECT id, name, email, created_at
             FROM users`;

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = await db.prepare(sql).bind(...params).all<AdminUserRow>();

  return Response.json({ result: results.results });
}

async function handleGetAdminUser(
  req: GetAdminUserRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id, name, email, created_at
       FROM users
       WHERE id = ?`
    )
    .bind(req.userId)
    .first<AdminUserRow>();

  return Response.json({ result: result });
}

async function handleCountUsers(
  _req: CountUsersRequest,
  db: D1Database
): Promise<Response> {
  const sql = `SELECT COUNT(*) AS count FROM users`;
  const result = await db.prepare(sql).first<{ count: number }>();

  return Response.json({ result: result?.count ?? 0 });
}

async function handleGetStorageStats(db: D1Database): Promise<Response> {
  const sql = `
    SELECT
      u.id              AS user_id,
      u.slug            AS slug,
      u.email,
      u.name,
      u.image,
      COALESCE(tm_cnt.team_count, 0)            AS team_count,
      COALESCE(dev_cnt.device_count, 0)          AS device_count,
      COALESCE(tok.total_tokens, 0)              AS total_tokens,
      COALESCE(tok7.tokens_7d, 0)                AS tokens_7d,
      COALESCE(tok30.tokens_30d, 0)              AS tokens_30d,
      COALESCE(tok.usage_row_count, 0)           AS usage_row_count,
      COALESCE(sess.session_count, 0)            AS session_count,
      COALESCE(sess.total_messages, 0)           AS total_messages,
      COALESCE(sess.total_duration_seconds, 0)   AS total_duration_seconds,
      COALESCE(tok.first_seen, sess.first_seen)  AS first_seen,
      COALESCE(tok.last_seen, sess.last_seen)    AS last_seen
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS team_count
      FROM team_members
      GROUP BY user_id
    ) tm_cnt ON tm_cnt.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(DISTINCT device_id) AS device_count
      FROM usage_records
      GROUP BY user_id
    ) dev_cnt ON dev_cnt.user_id = u.id
    LEFT JOIN (
      SELECT
        user_id,
        SUM(total_tokens)              AS total_tokens,
        COUNT(*)                        AS usage_row_count,
        MIN(hour_start)                AS first_seen,
        MAX(hour_start)                AS last_seen
      FROM usage_records
      GROUP BY user_id
    ) tok ON tok.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(total_tokens) AS tokens_7d
      FROM usage_records
      WHERE datetime(hour_start) >= datetime('now', '-7 days')
      GROUP BY user_id
    ) tok7 ON tok7.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(total_tokens) AS tokens_30d
      FROM usage_records
      WHERE datetime(hour_start) >= datetime('now', '-30 days')
      GROUP BY user_id
    ) tok30 ON tok30.user_id = u.id
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*)                        AS session_count,
        SUM(total_messages)            AS total_messages,
        SUM(duration_seconds)          AS total_duration_seconds,
        MIN(started_at)               AS first_seen,
        MAX(last_message_at)          AS last_seen
      FROM session_records
      GROUP BY user_id
    ) sess ON sess.user_id = u.id
    WHERE tok.user_id IS NOT NULL OR sess.user_id IS NOT NULL
    ORDER BY total_tokens DESC
  `;

  const results = await db.prepare(sql).all<StorageUserRow>();

  return Response.json({ result: results.results });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleAdminRpc(
  request: AdminRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "admin.listAuditLogs":
      return handleListAuditLogs(request, db);
    case "admin.getAuditLog":
      return handleGetAuditLog(request, db);
    case "admin.getSystemStats":
      return handleGetSystemStats(db);
    case "admin.listUsers":
      return handleListAdminUsers(request, db);
    case "admin.getUser":
      return handleGetAdminUser(request, db);
    case "admin.countUsers":
      return handleCountUsers(request, db);
    case "admin.getStorageStats":
      return handleGetStorageStats(db);
    default:
      return Response.json(
        { error: `Unknown admin method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

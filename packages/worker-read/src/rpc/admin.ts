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
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
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
  role?: string;
  isActive?: boolean;
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
  role?: string;
  isActive?: boolean;
}

export type AdminRpcRequest =
  | ListAuditLogsRequest
  | GetAuditLogRequest
  | GetSystemStatsRequest
  | ListAdminUsersRequest
  | GetAdminUserRequest
  | CountUsersRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListAuditLogs(
  req: ListAuditLogsRequest,
  db: D1Database
): Promise<Response> {
  const limit = req.limit ?? 50;
  const offset = req.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.userId) {
    conditions.push("user_id = ?");
    params.push(req.userId);
  }

  if (req.action) {
    conditions.push("action = ?");
    params.push(req.action);
  }

  if (req.resourceType) {
    conditions.push("resource_type = ?");
    params.push(req.resourceType);
  }

  if (req.fromDate) {
    conditions.push("created_at >= ?");
    params.push(req.fromDate);
  }

  if (req.toDate) {
    conditions.push("created_at < ?");
    params.push(req.toDate);
  }

  let sql = `SELECT id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
             FROM audit_logs`;

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = await db.prepare(sql).bind(...params).all<AuditLogRow>();

  return Response.json({ data: results.results });
}

async function handleGetAuditLog(
  req: GetAuditLogRequest,
  db: D1Database
): Promise<Response> {
  if (!req.logId) {
    return Response.json({ error: "logId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
       FROM audit_logs
       WHERE id = ?`
    )
    .bind(req.logId)
    .first<AuditLogRow>();

  return Response.json({ data: result });
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

  return Response.json({ data: result });
}

async function handleListAdminUsers(
  req: ListAdminUsersRequest,
  db: D1Database
): Promise<Response> {
  const limit = req.limit ?? 50;
  const offset = req.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.role) {
    conditions.push("role = ?");
    params.push(req.role);
  }

  if (req.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(req.isActive ? 1 : 0);
  }

  if (req.query) {
    conditions.push("(username LIKE ? OR email LIKE ?)");
    const pattern = `%${req.query}%`;
    params.push(pattern, pattern);
  }

  let sql = `SELECT id, username, email, role, is_active, created_at, last_login_at
             FROM users`;

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = await db.prepare(sql).bind(...params).all<AdminUserRow>();

  return Response.json({ data: results.results });
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
      `SELECT id, username, email, role, is_active, created_at, last_login_at
       FROM users
       WHERE id = ?`
    )
    .bind(req.userId)
    .first<AdminUserRow>();

  return Response.json({ data: result });
}

async function handleCountUsers(
  req: CountUsersRequest,
  db: D1Database
): Promise<Response> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.role) {
    conditions.push("role = ?");
    params.push(req.role);
  }

  if (req.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(req.isActive ? 1 : 0);
  }

  let sql = `SELECT COUNT(*) AS count FROM users`;

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  const result =
    params.length > 0
      ? await db.prepare(sql).bind(...params).first<{ count: number }>()
      : await db.prepare(sql).first<{ count: number }>();

  return Response.json({ data: result?.count ?? 0 });
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
    default:
      return Response.json(
        { error: `Unknown admin method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

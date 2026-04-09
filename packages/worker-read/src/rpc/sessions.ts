/**
 * Sessions domain RPC handlers for worker-read.
 *
 * Handles session-related read queries.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  user_id: string;
  source: string;
  session_key: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  total_messages: number;
  kind: string | null;
}

export interface SessionStatsRow {
  total_sessions: number;
  total_duration_seconds: number;
  avg_duration_seconds: number;
  avg_messages: number;
}

/** Session record with project info for /api/sessions */
export interface SessionRecordRow {
  session_key: string;
  source: string;
  kind: string;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  project_ref: string | null;
  project_name: string | null;
  model: string | null;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListSessionsRequest {
  method: "sessions.list";
  userId: string;
  source?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface GetSessionStatsRequest {
  method: "sessions.getStats";
  userId: string;
  fromDate?: string;
  toDate?: string;
}

export interface CountSessionsRequest {
  method: "sessions.count";
  userId: string;
  source?: string;
  fromDate?: string;
  toDate?: string;
}

export interface GetSessionRecordsRequest {
  method: "sessions.getRecords";
  userId: string;
  fromDate: string;
  toDate: string;
  source?: string;
  kind?: string;
}

export type SessionsRpcRequest =
  | ListSessionsRequest
  | GetSessionStatsRequest
  | CountSessionsRequest
  | GetSessionRecordsRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListSessions(
  req: ListSessionsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const limit = Math.min(req.limit ?? 50, 250);
  const offset = req.offset ?? 0;

  const conditions = ["user_id = ?"];
  const params: unknown[] = [req.userId];

  if (req.source) {
    conditions.push("source = ?");
    params.push(req.source);
  }

  if (req.fromDate) {
    conditions.push("started_at >= ?");
    params.push(req.fromDate);
  }

  if (req.toDate) {
    conditions.push("started_at < ?");
    params.push(req.toDate);
  }

  const sql = `SELECT id, user_id, source, session_key, started_at, ended_at,
                      duration_seconds, total_messages, kind
               FROM session_records
               WHERE ${conditions.join(" AND ")}
               ORDER BY started_at DESC
               LIMIT ? OFFSET ?`;

  params.push(limit, offset);

  const results = await db.prepare(sql).bind(...params).all<SessionRow>();

  return Response.json({ result: results.results });
}

async function handleGetSessionStats(
  req: GetSessionStatsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const conditions = ["user_id = ?"];
  const params: unknown[] = [req.userId];

  if (req.fromDate) {
    conditions.push("started_at >= ?");
    params.push(req.fromDate);
  }

  if (req.toDate) {
    conditions.push("started_at < ?");
    params.push(req.toDate);
  }

  const sql = `SELECT
                COUNT(*) AS total_sessions,
                COALESCE(SUM(duration_seconds), 0) AS total_duration_seconds,
                COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds,
                COALESCE(AVG(total_messages), 0) AS avg_messages
               FROM session_records
               WHERE ${conditions.join(" AND ")}`;

  const result = await db.prepare(sql).bind(...params).first<SessionStatsRow>();

  return Response.json({ result: result });
}

async function handleCountSessions(
  req: CountSessionsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const conditions = ["user_id = ?"];
  const params: unknown[] = [req.userId];

  if (req.source) {
    conditions.push("source = ?");
    params.push(req.source);
  }

  if (req.fromDate) {
    conditions.push("started_at >= ?");
    params.push(req.fromDate);
  }

  if (req.toDate) {
    conditions.push("started_at < ?");
    params.push(req.toDate);
  }

  const sql = `SELECT COUNT(*) AS count FROM session_records WHERE ${conditions.join(" AND ")}`;

  const result = await db.prepare(sql).bind(...params).first<{ count: number }>();

  return Response.json({ result: result?.count ?? 0 });
}

async function handleGetSessionRecords(
  req: GetSessionRecordsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "userId, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const conditions = [
    "sr.user_id = ?",
    "sr.started_at >= ?",
    "sr.started_at < ?",
  ];
  const params: unknown[] = [req.userId, req.fromDate, req.toDate];

  if (req.source) {
    conditions.push("sr.source = ?");
    params.push(req.source);
  }

  if (req.kind) {
    conditions.push("sr.kind = ?");
    params.push(req.kind);
  }

  const sql = `
    SELECT
      sr.session_key,
      sr.source,
      sr.kind,
      sr.started_at,
      sr.last_message_at,
      sr.duration_seconds,
      sr.user_messages,
      sr.assistant_messages,
      sr.total_messages,
      sr.project_ref,
      p.name AS project_name,
      sr.model
    FROM session_records sr
    LEFT JOIN project_aliases pa
      ON pa.user_id = sr.user_id
      AND pa.source = sr.source
      AND pa.project_ref = sr.project_ref
    LEFT JOIN projects p ON p.id = pa.project_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY sr.started_at DESC
  `;

  const results = await db.prepare(sql).bind(...params).all<SessionRecordRow>();

  return Response.json({ result: results.results });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleSessionsRpc(
  request: SessionsRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "sessions.list":
      return handleListSessions(request, db);
    case "sessions.getStats":
      return handleGetSessionStats(request, db);
    case "sessions.count":
      return handleCountSessions(request, db);
    case "sessions.getRecords":
      return handleGetSessionRecords(request, db);
    default:
      return Response.json(
        { error: `Unknown sessions method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

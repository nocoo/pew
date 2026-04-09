/**
 * Auth domain RPC handlers for worker-read.
 *
 * Handles auth-related read queries (invite codes, auth codes, etc.)
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface InviteCodeRow {
  id: string;
  code: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

export interface AuthCodeRow {
  code: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  failed_attempts: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetInviteCodeRequest {
  method: "auth.getInviteCode";
  code: string;
}

export interface CheckInviteCodeExistsRequest {
  method: "auth.checkInviteCodeExists";
  code: string;
}

export interface ListInviteCodesRequest {
  method: "auth.listInviteCodes";
  unused?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetAuthCodeRequest {
  method: "auth.getAuthCode";
  code: string;
}

export interface CheckUserHasUnusedInviteRequest {
  method: "auth.checkUserHasUnusedInvite";
  userId: string;
}

export type AuthRpcRequest =
  | GetInviteCodeRequest
  | CheckInviteCodeExistsRequest
  | ListInviteCodesRequest
  | GetAuthCodeRequest
  | CheckUserHasUnusedInviteRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetInviteCode(
  req: GetInviteCodeRequest,
  db: D1Database
): Promise<Response> {
  if (!req.code) {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id, code, used_by, used_at, created_at
       FROM invite_codes
       WHERE code = ?`
    )
    .bind(req.code)
    .first<InviteCodeRow>();

  return Response.json({ result: result });
}

async function handleCheckInviteCodeExists(
  req: CheckInviteCodeExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.code) {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT id FROM invite_codes WHERE code = ?`)
    .bind(req.code)
    .first<{ id: string }>();

  return Response.json({ result: { exists: result !== null } });
}

async function handleListInviteCodes(
  req: ListInviteCodesRequest,
  db: D1Database
): Promise<Response> {
  const limit = req.limit ?? 50;
  const offset = req.offset ?? 0;

  let sql = `SELECT id, code, used_by, used_at, created_at FROM invite_codes`;
  const params: unknown[] = [];

  if (req.unused) {
    sql += ` WHERE used_by IS NULL`;
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = await db.prepare(sql).bind(...params).all<InviteCodeRow>();

  return Response.json({ result: results.results });
}

async function handleGetAuthCode(
  req: GetAuthCodeRequest,
  db: D1Database
): Promise<Response> {
  if (!req.code) {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT code, user_id, expires_at, used_at, failed_attempts
       FROM auth_codes
       WHERE code = ?`
    )
    .bind(req.code)
    .first<AuthCodeRow>();

  return Response.json({ result: result });
}

async function handleCheckUserHasUnusedInvite(
  req: CheckUserHasUnusedInviteRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id FROM invite_codes
       WHERE created_by = ? AND used_by IS NULL
       LIMIT 1`
    )
    .bind(req.userId)
    .first<{ id: string }>();

  return Response.json({ result: { hasUnused: result !== null } });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleAuthRpc(
  request: AuthRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "auth.getInviteCode":
      return handleGetInviteCode(request, db);
    case "auth.checkInviteCodeExists":
      return handleCheckInviteCodeExists(request, db);
    case "auth.listInviteCodes":
      return handleListInviteCodes(request, db);
    case "auth.getAuthCode":
      return handleGetAuthCode(request, db);
    case "auth.checkUserHasUnusedInvite":
      return handleCheckUserHasUnusedInvite(request, db);
    default:
      return Response.json(
        { error: `Unknown auth method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

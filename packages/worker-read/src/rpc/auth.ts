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
  id: number;
  code: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
  created_by: string | null;
  created_by_email: string | null;
  used_by_email: string | null;
}

/** Minimal shape for existence check — includes used_by for consumption check */
export interface InviteCodeSimple {
  id: number;
  used_by: string | null;
}

/** Shape for getInviteCodeById */
export interface InviteCodeById {
  id: number;
  code: string;
  used_by: string | null;
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

export interface CheckInviteCodeRequest {
  method: "auth.checkInviteCode";
  code: string;
}

export interface GetInviteCodeByIdRequest {
  method: "auth.getInviteCodeById";
  id: number;
}

export interface ListInviteCodesRequest {
  method: "auth.listInviteCodes";
  unused?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetCodeRequest {
  method: "auth.getCode";
  code: string;
}

export interface UserHasUnusedInviteRequest {
  method: "auth.userHasUnusedInvite";
  userId: string;
}

export type AuthRpcRequest =
  | GetInviteCodeRequest
  | CheckInviteCodeRequest
  | GetInviteCodeByIdRequest
  | ListInviteCodesRequest
  | GetCodeRequest
  | UserHasUnusedInviteRequest;

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

/** Check if invite code exists and return id + used_by for consumption check */
async function handleCheckInviteCode(
  req: CheckInviteCodeRequest,
  db: D1Database
): Promise<Response> {
  if (!req.code) {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT id, used_by FROM invite_codes WHERE code = ?`)
    .bind(req.code)
    .first<InviteCodeSimple>();

  // Return null if not found, otherwise the row
  return Response.json({ result: result });
}

/** Get invite code by ID (for DELETE fallback check) */
async function handleGetInviteCodeById(
  req: GetInviteCodeByIdRequest,
  db: D1Database
): Promise<Response> {
  if (req.id === undefined || req.id === null) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT id, code, used_by FROM invite_codes WHERE id = ?`)
    .bind(req.id)
    .first<InviteCodeById>();

  return Response.json({ result: result });
}

async function handleListInviteCodes(
  req: ListInviteCodesRequest,
  db: D1Database
): Promise<Response> {
  const limit = Math.min(req.limit ?? 50, 250);
  const offset = req.offset ?? 0;

  // Join with users table to get creator and consumer emails
  let sql = `
    SELECT
      ic.id,
      ic.code,
      ic.used_by,
      ic.used_at,
      ic.created_at,
      ic.created_by,
      creator.email AS created_by_email,
      consumer.email AS used_by_email
    FROM invite_codes ic
    LEFT JOIN users creator ON creator.id = ic.created_by
    LEFT JOIN users consumer ON consumer.id = ic.used_by
  `;
  const params: unknown[] = [];

  if (req.unused) {
    sql += ` WHERE ic.used_by IS NULL`;
  }

  sql += ` ORDER BY ic.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = await db.prepare(sql).bind(...params).all<InviteCodeRow>();

  return Response.json({ result: results.results });
}

/** Get auth code by code string */
async function handleGetCode(
  req: GetCodeRequest,
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

async function handleUserHasUnusedInvite(
  req: UserHasUnusedInviteRequest,
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
    .first<{ id: number }>();

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
    case "auth.checkInviteCode":
      return handleCheckInviteCode(request, db);
    case "auth.getInviteCodeById":
      return handleGetInviteCodeById(request, db);
    case "auth.listInviteCodes":
      return handleListInviteCodes(request, db);
    case "auth.getCode":
      return handleGetCode(request, db);
    case "auth.userHasUnusedInvite":
      return handleUserHasUnusedInvite(request, db);
    default:
      return Response.json(
        { error: `Unknown auth method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

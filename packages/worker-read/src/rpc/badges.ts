/**
 * Badges domain RPC handlers for worker-read.
 *
 * Handles all badge-related read queries with typed interfaces.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { BadgeAssignmentStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Response Types (DB row shapes)
// ---------------------------------------------------------------------------

export interface BadgeRow {
  id: string;
  text: string;
  icon: string;
  color_bg: string;
  color_text: string;
  description: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export interface BadgeAssignmentRow {
  id: string;
  badge_id: string;
  user_id: string;
  snapshot_text: string;
  snapshot_icon: string;
  snapshot_bg: string;
  snapshot_fg: string;
  assigned_at: string;
  expires_at: string;
  assigned_by: string;
  note: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Active badge for display (uses snapshot fields) */
export interface ActiveBadgeRow {
  id: string;
  text: string;
  icon: string;
  color_bg: string;
  color_text: string;
  assigned_at: string;
  expires_at: string;
}

/** Assignment with user and badge info (for admin list) */
export interface AssignmentWithDetailsRow extends BadgeAssignmentRow {
  user_name: string | null;
  user_image: string | null;
  user_slug: string | null;
  assigned_by_name: string | null;
  revoked_by_name: string | null;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListBadgesRequest {
  method: "badges.list";
  includeArchived?: boolean;
}

export interface GetBadgeRequest {
  method: "badges.get";
  badgeId: string;
}

export interface GetActiveBadgesForUserRequest {
  method: "badges.getActiveForUser";
  userId: string;
}

export interface GetActiveBadgesForUsersRequest {
  method: "badges.getActiveForUsers";
  userIds: string[];
}

export interface ListAssignmentsRequest {
  method: "badges.listAssignments";
  badgeId?: string;
  userId?: string;
  /** Filter by status: revoked = revoked_early only, cleared = revoked_post_expiry only */
  status?: "active" | "expired" | "revoked" | "cleared" | "all";
  limit: number;
  offset: number;
}

export interface GetAssignmentRequest {
  method: "badges.getAssignment";
  assignmentId: string;
}

export interface CheckNonRevokedAssignmentRequest {
  method: "badges.checkNonRevokedAssignment";
  badgeId: string;
  userId: string;
}

export type BadgesRpcRequest =
  | ListBadgesRequest
  | GetBadgeRequest
  | GetActiveBadgesForUserRequest
  | GetActiveBadgesForUsersRequest
  | ListAssignmentsRequest
  | GetAssignmentRequest
  | CheckNonRevokedAssignmentRequest;

// ---------------------------------------------------------------------------
// Status derivation helper
// ---------------------------------------------------------------------------

export function deriveAssignmentStatus(
  revokedAt: string | null,
  expiresAt: string,
  now: Date = new Date(),
): BadgeAssignmentStatus {
  if (revokedAt) {
    const revokedDate = new Date(revokedAt);
    const expiresDate = new Date(expiresAt);
    return revokedDate <= expiresDate ? "revoked_early" : "revoked_post_expiry";
  }
  if (new Date(expiresAt) <= now) return "expired";
  return "active";
}

// ---------------------------------------------------------------------------
// RPC Handler
// ---------------------------------------------------------------------------

export async function handleBadgesRpc(
  request: BadgesRpcRequest,
  db: D1Database,
): Promise<Response> {
  switch (request.method) {
    case "badges.list":
      return handleListBadges(request, db);
    case "badges.get":
      return handleGetBadge(request, db);
    case "badges.getActiveForUser":
      return handleGetActiveForUser(request, db);
    case "badges.getActiveForUsers":
      return handleGetActiveForUsers(request, db);
    case "badges.listAssignments":
      return handleListAssignments(request, db);
    case "badges.getAssignment":
      return handleGetAssignment(request, db);
    case "badges.checkNonRevokedAssignment":
      return handleCheckNonRevokedAssignment(request, db);
    default:
      return Response.json(
        { error: `Unknown badges method: ${(request as { method: string }).method}` },
        { status: 400 },
      );
  }
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

async function handleListBadges(
  request: ListBadgesRequest,
  db: D1Database,
): Promise<Response> {
  const { includeArchived = false } = request;

  const sql = includeArchived
    ? `SELECT * FROM badges ORDER BY created_at DESC`
    : `SELECT * FROM badges WHERE is_archived = 0 ORDER BY created_at DESC`;

  const result = await db.prepare(sql).all<BadgeRow>();

  return Response.json({ result: { badges: result.results ?? [] } });
}

async function handleGetBadge(
  request: GetBadgeRequest,
  db: D1Database,
): Promise<Response> {
  const row = await db
    .prepare(`SELECT * FROM badges WHERE id = ?`)
    .bind(request.badgeId)
    .first<BadgeRow>();

  if (!row) {
    return Response.json({ error: "Badge not found" }, { status: 404 });
  }

  return Response.json({ result: { badge: row } });
}

async function handleGetActiveForUser(
  request: GetActiveBadgesForUserRequest,
  db: D1Database,
): Promise<Response> {
  const now = new Date().toISOString();

  const result = await db
    .prepare(
      `SELECT
        id,
        snapshot_text AS text,
        snapshot_icon AS icon,
        snapshot_bg AS color_bg,
        snapshot_fg AS color_text,
        assigned_at,
        expires_at
      FROM badge_assignments
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      ORDER BY assigned_at DESC`,
    )
    .bind(request.userId, now)
    .all<ActiveBadgeRow>();

  return Response.json({ result: { badges: result.results ?? [] } });
}

async function handleGetActiveForUsers(
  request: GetActiveBadgesForUsersRequest,
  db: D1Database,
): Promise<Response> {
  const { userIds } = request;

  if (userIds.length === 0) {
    return Response.json({ result: { badges: {} } });
  }

  const now = new Date().toISOString();
  const placeholders = userIds.map(() => "?").join(", ");

  const result = await db
    .prepare(
      `SELECT
        user_id,
        id,
        snapshot_text AS text,
        snapshot_icon AS icon,
        snapshot_bg AS color_bg,
        snapshot_fg AS color_text,
        assigned_at,
        expires_at
      FROM badge_assignments
      WHERE user_id IN (${placeholders})
        AND revoked_at IS NULL
        AND expires_at > ?
      ORDER BY assigned_at DESC`,
    )
    .bind(...userIds, now)
    .all<ActiveBadgeRow & { user_id: string }>();

  // Group by user_id
  const badgesByUser: Record<string, ActiveBadgeRow[]> = {};
  for (const row of result.results ?? []) {
    const userId = row.user_id;
    if (!badgesByUser[userId]) {
      badgesByUser[userId] = [];
    }
    badgesByUser[userId].push({
      id: row.id,
      text: row.text,
      icon: row.icon,
      color_bg: row.color_bg,
      color_text: row.color_text,
      assigned_at: row.assigned_at,
      expires_at: row.expires_at,
    });
  }

  return Response.json({ result: { badges: badgesByUser } });
}

async function handleListAssignments(
  request: ListAssignmentsRequest,
  db: D1Database,
): Promise<Response> {
  const { badgeId, userId, status = "all", limit, offset } = request;

  const now = new Date().toISOString();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (badgeId) {
    conditions.push("ba.badge_id = ?");
    params.push(badgeId);
  }

  if (userId) {
    conditions.push("ba.user_id = ?");
    params.push(userId);
  }

  // Status filter
  switch (status) {
    case "active":
      conditions.push("ba.revoked_at IS NULL AND ba.expires_at > ?");
      params.push(now);
      break;
    case "expired":
      conditions.push("ba.revoked_at IS NULL AND ba.expires_at <= ?");
      params.push(now);
      break;
    case "revoked":
      // revoked_early: revoked while still active (revoked_at <= expires_at)
      conditions.push("ba.revoked_at IS NOT NULL AND ba.revoked_at <= ba.expires_at");
      break;
    case "cleared":
      // revoked_post_expiry: cleared after already expired (revoked_at > expires_at)
      conditions.push("ba.revoked_at IS NOT NULL AND ba.revoked_at > ba.expires_at");
      break;
    // "all" - no additional filter
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT
      ba.*,
      u.name AS user_name,
      u.image AS user_image,
      u.slug AS user_slug,
      ab.name AS assigned_by_name,
      rb.name AS revoked_by_name
    FROM badge_assignments ba
    LEFT JOIN users u ON u.id = ba.user_id
    LEFT JOIN users ab ON ab.id = ba.assigned_by
    LEFT JOIN users rb ON rb.id = ba.revoked_by
    ${whereClause}
    ORDER BY ba.assigned_at DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);

  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<AssignmentWithDetailsRow>();

  // Derive status for each assignment
  const assignments = (result.results ?? []).map((row) => ({
    ...row,
    status: deriveAssignmentStatus(row.revoked_at, row.expires_at),
  }));

  return Response.json({ result: { assignments } });
}

async function handleGetAssignment(
  request: GetAssignmentRequest,
  db: D1Database,
): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT
        ba.*,
        u.name AS user_name,
        u.image AS user_image,
        u.slug AS user_slug,
        ab.name AS assigned_by_name,
        rb.name AS revoked_by_name
      FROM badge_assignments ba
      LEFT JOIN users u ON u.id = ba.user_id
      LEFT JOIN users ab ON ab.id = ba.assigned_by
      LEFT JOIN users rb ON rb.id = ba.revoked_by
      WHERE ba.id = ?`,
    )
    .bind(request.assignmentId)
    .first<AssignmentWithDetailsRow>();

  if (!row) {
    return Response.json({ error: "Assignment not found" }, { status: 404 });
  }

  return Response.json({
    result: {
      assignment: {
        ...row,
        status: deriveAssignmentStatus(row.revoked_at, row.expires_at),
      },
    },
  });
}

async function handleCheckNonRevokedAssignment(
  request: CheckNonRevokedAssignmentRequest,
  db: D1Database,
): Promise<Response> {
  const { badgeId, userId } = request;
  const now = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT id, expires_at, revoked_at
      FROM badge_assignments
      WHERE badge_id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(badgeId, userId)
    .first<{ id: string; expires_at: string; revoked_at: string | null }>();

  if (!row) {
    return Response.json({ result: { exists: false } });
  }

  const isActive = new Date(row.expires_at) > new Date(now);

  return Response.json({
    result: {
      exists: true,
      assignmentId: row.id,
      isActive,
      expiresAt: row.expires_at,
    },
  });
}

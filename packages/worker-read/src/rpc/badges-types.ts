/**
 * Type-only definitions for the badges RPC. Extracted from badges.ts so the
 * handler file stays under the 400-LOC complexity guideline.
 */

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

interface BadgeAssignmentRow {
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

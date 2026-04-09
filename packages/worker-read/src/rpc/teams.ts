/**
 * Teams domain RPC handlers for worker-read.
 *
 * Handles all team-related read queries with typed interfaces.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface TeamRow {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  logo_url: string | null;
  member_count: number;
}

export interface TeamDetailRow {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_at: string;
  logo_url: string | null;
  auto_register_season: number | null;
}

export interface TeamMemberRow {
  user_id: string;
  name: string | null;
  nickname: string | null;
  slug: string | null;
  image: string | null;
  role: string;
  joined_at: string;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetTeamMembershipRequest {
  method: "teams.getMembership";
  teamId: string;
  userId: string;
}

export interface ListUserTeamsRequest {
  method: "teams.listForUser";
  userId: string;
}

export interface CheckTeamSlugExistsRequest {
  method: "teams.checkSlugExists";
  slug: string;
}

export interface GetTeamByIdRequest {
  method: "teams.getById";
  teamId: string;
}

export interface GetTeamMembersRequest {
  method: "teams.getMembers";
  teamId: string;
}

export interface GetTeamSeasonRegistrationsRequest {
  method: "teams.getSeasonRegistrations";
  teamId: string;
}

export interface CountTeamMembersRequest {
  method: "teams.countMembers";
  teamId: string;
}

export interface GetTeamLogoUrlRequest {
  method: "teams.getLogoUrl";
  teamId: string;
}

export interface FindTeamByInviteCodeRequest {
  method: "teams.findByInviteCode";
  inviteCode: string;
}

export interface CheckTeamMembershipExistsRequest {
  method: "teams.membershipExists";
  teamId: string;
  userId: string;
}

export interface GetAppSettingRequest {
  method: "teams.getAppSetting";
  key: string;
}

export interface GetTeamMemberUserIdsRequest {
  method: "teams.getMemberUserIds";
  teamId: string;
}

export interface GetTeamOwnerRequest {
  method: "teams.getOwner";
  teamId: string;
}

export interface CheckUsersShareTeamRequest {
  method: "teams.usersShareTeam";
  userId1: string;
  userId2: string;
}

export type TeamsRpcRequest =
  | GetTeamMembershipRequest
  | ListUserTeamsRequest
  | CheckTeamSlugExistsRequest
  | GetTeamByIdRequest
  | GetTeamMembersRequest
  | GetTeamSeasonRegistrationsRequest
  | CountTeamMembersRequest
  | GetTeamLogoUrlRequest
  | FindTeamByInviteCodeRequest
  | CheckTeamMembershipExistsRequest
  | GetAppSettingRequest
  | GetTeamMemberUserIdsRequest
  | GetTeamOwnerRequest
  | CheckUsersShareTeamRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetTeamMembership(
  req: GetTeamMembershipRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId || !req.userId) {
    return Response.json(
      { error: "teamId and userId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`)
    .bind(req.teamId, req.userId)
    .first<{ role: string }>();

  return Response.json({ result: result });
}

async function handleListUserTeams(
  req: ListUserTeamsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT t.id, t.name, t.slug, t.invite_code, t.created_by, t.created_at, t.logo_url,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ?
       ORDER BY t.created_at DESC`
    )
    .bind(req.userId)
    .all<TeamRow>();

  return Response.json({ result: results.results });
}

async function handleCheckTeamSlugExists(
  req: CheckTeamSlugExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT id FROM teams WHERE slug = ?`)
    .bind(req.slug)
    .first<{ id: string }>();

  return Response.json({ result: { exists: result !== null } });
}

async function handleGetTeamById(
  req: GetTeamByIdRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  // Try with auto_register_season first, fall back without it
  try {
    const result = await db
      .prepare(
        `SELECT id, name, slug, invite_code, created_at, logo_url, auto_register_season
         FROM teams WHERE id = ?`
      )
      .bind(req.teamId)
      .first<TeamDetailRow>();

    return Response.json({ result: result });
  } catch (err) {
    // Fall back to query without auto_register_season
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such column: auto_register_season")) {
      const result = await db
        .prepare(
          `SELECT id, name, slug, invite_code, created_at, logo_url
           FROM teams WHERE id = ?`
        )
        .bind(req.teamId)
        .first<Omit<TeamDetailRow, "auto_register_season">>();

      return Response.json({
        result: result ? { ...result, auto_register_season: null } : null,
      });
    }
    throw err;
  }
}

async function handleGetTeamMembers(
  req: GetTeamMembersRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  // Try with nickname/slug first, fall back without
  try {
    const results = await db
      .prepare(
        `SELECT tm.user_id, u.name, u.nickname, u.slug, u.image, tm.role, tm.joined_at
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ?
         ORDER BY tm.joined_at ASC`
      )
      .bind(req.teamId)
      .all<TeamMemberRow>();

    return Response.json({ result: results.results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such column")) {
      const results = await db
        .prepare(
          `SELECT tm.user_id, u.name, u.image, tm.role, tm.joined_at
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = ?
           ORDER BY tm.joined_at ASC`
        )
        .bind(req.teamId)
        .all<Omit<TeamMemberRow, "nickname" | "slug">>();

      return Response.json({
        result: results.results.map((m) => ({
          ...m,
          nickname: null,
          slug: null,
        })),
      });
    }
    throw err;
  }
}

async function handleGetTeamSeasonRegistrations(
  req: GetTeamSeasonRegistrationsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(`SELECT season_id FROM season_teams WHERE team_id = ?`)
    .bind(req.teamId)
    .all<{ season_id: string }>();

  return Response.json({ result: results.results.map((r) => r.season_id) });
}

async function handleCountTeamMembers(
  req: CountTeamMembersRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM team_members WHERE team_id = ?`)
    .bind(req.teamId)
    .first<{ cnt: number }>();

  return Response.json({ result: { count: result?.cnt ?? 0 } });
}

async function handleGetTeamLogoUrl(
  req: GetTeamLogoUrlRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT logo_url FROM teams WHERE id = ?`)
    .bind(req.teamId)
    .first<{ logo_url: string | null }>();

  return Response.json({ result: result });
}

async function handleFindTeamByInviteCode(
  req: FindTeamByInviteCodeRequest,
  db: D1Database
): Promise<Response> {
  if (!req.inviteCode) {
    return Response.json({ error: "inviteCode is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT id, name, slug FROM teams WHERE invite_code = ?`)
    .bind(req.inviteCode)
    .first<{ id: string; name: string; slug: string }>();

  return Response.json({ result: result });
}

async function handleCheckTeamMembershipExists(
  req: CheckTeamMembershipExistsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId || !req.userId) {
    return Response.json(
      { error: "teamId and userId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(`SELECT id FROM team_members WHERE team_id = ? AND user_id = ?`)
    .bind(req.teamId, req.userId)
    .first<{ id: string }>();

  return Response.json({ result: { exists: result !== null } });
}

async function handleGetAppSetting(
  req: GetAppSettingRequest,
  db: D1Database
): Promise<Response> {
  if (!req.key) {
    return Response.json({ error: "key is required" }, { status: 400 });
  }

  const result = await db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .bind(req.key)
    .first<{ value: string }>();

  return Response.json({ result: result?.value ?? null });
}

async function handleGetTeamMemberUserIds(
  req: GetTeamMemberUserIdsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(`SELECT user_id FROM team_members WHERE team_id = ?`)
    .bind(req.teamId)
    .all<{ user_id: string }>();

  return Response.json({ result: results.results.map((r) => r.user_id) });
}

async function handleGetTeamOwner(
  req: GetTeamOwnerRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner' LIMIT 1`
    )
    .bind(req.teamId)
    .first<{ user_id: string }>();

  return Response.json({ result: result?.user_id ?? null });
}

async function handleCheckUsersShareTeam(
  req: CheckUsersShareTeamRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userId1 || !req.userId2) {
    return Response.json(
      { error: "userId1 and userId2 are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT a.team_id
       FROM team_members a
       JOIN team_members b ON a.team_id = b.team_id
       WHERE a.user_id = ? AND b.user_id = ?
       LIMIT 1`
    )
    .bind(req.userId1, req.userId2)
    .first<{ team_id: string }>();

  return Response.json({ result: { shared: result !== null } });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleTeamsRpc(
  request: TeamsRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "teams.getMembership":
      return handleGetTeamMembership(request, db);
    case "teams.listForUser":
      return handleListUserTeams(request, db);
    case "teams.checkSlugExists":
      return handleCheckTeamSlugExists(request, db);
    case "teams.getById":
      return handleGetTeamById(request, db);
    case "teams.getMembers":
      return handleGetTeamMembers(request, db);
    case "teams.getSeasonRegistrations":
      return handleGetTeamSeasonRegistrations(request, db);
    case "teams.countMembers":
      return handleCountTeamMembers(request, db);
    case "teams.getLogoUrl":
      return handleGetTeamLogoUrl(request, db);
    case "teams.findByInviteCode":
      return handleFindTeamByInviteCode(request, db);
    case "teams.membershipExists":
      return handleCheckTeamMembershipExists(request, db);
    case "teams.getAppSetting":
      return handleGetAppSetting(request, db);
    case "teams.getMemberUserIds":
      return handleGetTeamMemberUserIds(request, db);
    case "teams.getOwner":
      return handleGetTeamOwner(request, db);
    case "teams.usersShareTeam":
      return handleCheckUsersShareTeam(request, db);
    default:
      return Response.json(
        { error: `Unknown teams method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

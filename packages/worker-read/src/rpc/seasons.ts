/**
 * Seasons domain RPC handlers for worker-read.
 *
 * Handles all season-related read queries with typed interfaces.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface SeasonRow {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  created_at: string;
  team_count: number;
  has_snapshot: number;
  allow_late_registration: number;
  allow_late_withdrawal: number;
}

export interface SeasonDetailRow {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  snapshot_ready: number;
  allow_late_registration: number;
  allow_late_withdrawal: number;
}

export interface SeasonTeamRegistrationRow {
  id: string;
  season_id: string;
  team_id: string;
  registered_by: string;
  created_at: string;
}

export interface SeasonSnapshotRow {
  team_id: string;
  team_name: string;
  team_slug: string;
  team_logo_url: string | null;
  rank: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface SeasonMemberSnapshotRow {
  team_id: string;
  user_id: string;
  slug: string | null;
  name: string | null;
  nickname: string | null;
  image: string | null;
  is_public: number | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface TeamTokenRow {
  team_id: string;
  team_name: string;
  team_slug: string;
  team_logo_url: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface MemberTokenRow {
  team_id: string;
  user_id: string;
  slug: string | null;
  name: string | null;
  nickname: string | null;
  image: string | null;
  is_public: number | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface TeamSessionStatsRow {
  team_id: string;
  session_count: number;
  total_duration_seconds: number;
}

export interface MemberSessionStatsRow {
  team_id: string;
  user_id: string;
  session_count: number;
  total_duration_seconds: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface ListSeasonsRequest {
  method: "seasons.list";
}

export interface GetSeasonByIdRequest {
  method: "seasons.getById";
  seasonId: string;
}

export interface GetSeasonBySlugRequest {
  method: "seasons.getBySlug";
  slug: string;
}

export interface GetSeasonRegistrationRequest {
  method: "seasons.getRegistration";
  seasonId: string;
  teamId: string;
}

export interface CheckSeasonMemberConflictRequest {
  method: "seasons.checkMemberConflict";
  seasonId: string;
  userIds: string[];
}

export interface GetSeasonSnapshotsRequest {
  method: "seasons.getSnapshots";
  seasonId: string;
}

export interface GetSeasonMemberSnapshotsRequest {
  method: "seasons.getMemberSnapshots";
  seasonId: string;
  publicOnly?: boolean;
}

export interface GetSeasonTeamTokensRequest {
  method: "seasons.getTeamTokens";
  seasonId: string;
  fromDate: string;
  toDate: string;
}

export interface GetSeasonMemberTokensRequest {
  method: "seasons.getMemberTokens";
  seasonId: string;
  teamIds: string[];
  fromDate: string;
  toDate: string;
  publicOnly?: boolean;
}

export interface GetSeasonTeamSessionStatsRequest {
  method: "seasons.getTeamSessionStats";
  seasonId: string;
  teamIds: string[];
  fromDate: string;
  toDate: string;
}

export interface GetSeasonMemberSessionStatsRequest {
  method: "seasons.getMemberSessionStats";
  seasonId: string;
  teamIds: string[];
  fromDate: string;
  toDate: string;
}

export interface GetSeasonTeamMembersRequest {
  method: "seasons.getTeamMembers";
  teamId: string;
}

export type SeasonsRpcRequest =
  | ListSeasonsRequest
  | GetSeasonByIdRequest
  | GetSeasonBySlugRequest
  | GetSeasonRegistrationRequest
  | CheckSeasonMemberConflictRequest
  | GetSeasonSnapshotsRequest
  | GetSeasonMemberSnapshotsRequest
  | GetSeasonTeamTokensRequest
  | GetSeasonMemberTokensRequest
  | GetSeasonTeamSessionStatsRequest
  | GetSeasonMemberSessionStatsRequest
  | GetSeasonTeamMembersRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListSeasons(db: D1Database): Promise<Response> {
  const results = await db
    .prepare(
      `SELECT
         s.id, s.name, s.slug, s.start_date, s.end_date, s.created_at,
         s.allow_late_registration, s.allow_late_withdrawal,
         COUNT(st.id) AS team_count,
         s.snapshot_ready AS has_snapshot
       FROM seasons s
       LEFT JOIN season_teams st ON st.season_id = s.id
       GROUP BY s.id
       ORDER BY s.start_date DESC`
    )
    .all<SeasonRow>();

  return Response.json({ data: results.results });
}

async function handleGetSeasonById(
  req: GetSeasonByIdRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId) {
    return Response.json({ error: "seasonId is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id, name, slug, start_date, end_date, snapshot_ready,
              allow_late_registration, allow_late_withdrawal
       FROM seasons WHERE id = ?`
    )
    .bind(req.seasonId)
    .first<SeasonDetailRow>();

  return Response.json({ data: result });
}

async function handleGetSeasonBySlug(
  req: GetSeasonBySlugRequest,
  db: D1Database
): Promise<Response> {
  if (!req.slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const result = await db
    .prepare(
      `SELECT id, name, slug, start_date, end_date, snapshot_ready,
              allow_late_registration, allow_late_withdrawal
       FROM seasons WHERE slug = ?`
    )
    .bind(req.slug)
    .first<SeasonDetailRow>();

  return Response.json({ data: result });
}

async function handleGetSeasonRegistration(
  req: GetSeasonRegistrationRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.teamId) {
    return Response.json(
      { error: "seasonId and teamId are required" },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `SELECT id, season_id, team_id, registered_by, created_at
       FROM season_teams
       WHERE season_id = ? AND team_id = ?`
    )
    .bind(req.seasonId, req.teamId)
    .first<SeasonTeamRegistrationRow>();

  return Response.json({ data: result });
}

async function handleCheckSeasonMemberConflict(
  req: CheckSeasonMemberConflictRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.userIds || req.userIds.length === 0) {
    return Response.json(
      { error: "seasonId and userIds are required" },
      { status: 400 }
    );
  }

  const placeholders = req.userIds.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT user_id FROM season_team_members
       WHERE season_id = ? AND user_id IN (${placeholders})
       LIMIT 1`
    )
    .bind(req.seasonId, ...req.userIds)
    .first<{ user_id: string }>();

  return Response.json({ data: result });
}

async function handleGetSeasonSnapshots(
  req: GetSeasonSnapshotsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId) {
    return Response.json({ error: "seasonId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(
      `SELECT
        ss.team_id,
        t.name AS team_name,
        t.slug AS team_slug,
        t.logo_url AS team_logo_url,
        ss.rank,
        ss.total_tokens,
        ss.input_tokens,
        ss.output_tokens,
        ss.cached_input_tokens
      FROM season_snapshots ss
      JOIN teams t ON t.id = ss.team_id
      WHERE ss.season_id = ?
      ORDER BY ss.rank ASC`
    )
    .bind(req.seasonId)
    .all<SeasonSnapshotRow>();

  return Response.json({ data: results.results });
}

async function handleGetSeasonMemberSnapshots(
  req: GetSeasonMemberSnapshotsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId) {
    return Response.json({ error: "seasonId is required" }, { status: 400 });
  }

  let sql = `SELECT
      sms.team_id,
      sms.user_id,
      u.slug,
      u.name,
      u.nickname,
      u.image,
      u.is_public,
      sms.total_tokens,
      sms.input_tokens,
      sms.output_tokens,
      sms.cached_input_tokens
    FROM season_member_snapshots sms
    JOIN users u ON u.id = sms.user_id
    WHERE sms.season_id = ?`;

  if (req.publicOnly) {
    sql += ` AND u.is_public = 1`;
  }

  sql += ` ORDER BY sms.total_tokens DESC`;

  const results = await db.prepare(sql).bind(req.seasonId).all<SeasonMemberSnapshotRow>();

  return Response.json({ data: results.results });
}

async function handleGetSeasonTeamTokens(
  req: GetSeasonTeamTokensRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "seasonId, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const results = await db
    .prepare(
      `SELECT
        st.team_id,
        t.name AS team_name,
        t.slug AS team_slug,
        t.logo_url AS team_logo_url,
        COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
        COALESCE(SUM(ur.input_tokens), 0) AS input_tokens,
        COALESCE(SUM(ur.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(ur.cached_input_tokens), 0) AS cached_input_tokens
      FROM season_teams st
      JOIN teams t ON t.id = st.team_id
      LEFT JOIN season_team_members tm ON tm.team_id = st.team_id AND tm.season_id = st.season_id
      LEFT JOIN usage_records ur ON ur.user_id = tm.user_id
        AND ur.hour_start >= ?
        AND ur.hour_start < ?
      WHERE st.season_id = ?
      GROUP BY st.team_id
      ORDER BY total_tokens DESC`
    )
    .bind(req.fromDate, req.toDate, req.seasonId)
    .all<TeamTokenRow>();

  return Response.json({ data: results.results });
}

async function handleGetSeasonMemberTokens(
  req: GetSeasonMemberTokensRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.teamIds || req.teamIds.length === 0 || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "seasonId, teamIds, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const placeholders = req.teamIds.map(() => "?").join(",");
  let sql = `SELECT
      tm.team_id,
      tm.user_id,
      u.slug,
      u.name,
      u.nickname,
      u.image,
      u.is_public,
      COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
      COALESCE(SUM(ur.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(ur.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(ur.cached_input_tokens), 0) AS cached_input_tokens
    FROM season_team_members tm
    JOIN users u ON u.id = tm.user_id
    LEFT JOIN usage_records ur ON ur.user_id = tm.user_id
      AND ur.hour_start >= ?
      AND ur.hour_start < ?
    WHERE tm.season_id = ?
      AND tm.team_id IN (${placeholders})`;

  if (req.publicOnly) {
    sql += ` AND u.is_public = 1`;
  }

  sql += ` GROUP BY tm.team_id, tm.user_id ORDER BY total_tokens DESC`;

  const results = await db
    .prepare(sql)
    .bind(req.fromDate, req.toDate, req.seasonId, ...req.teamIds)
    .all<MemberTokenRow>();

  return Response.json({ data: results.results });
}

async function handleGetSeasonTeamSessionStats(
  req: GetSeasonTeamSessionStatsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.teamIds || req.teamIds.length === 0 || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "seasonId, teamIds, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const placeholders = req.teamIds.map(() => "?").join(",");
  const results = await db
    .prepare(
      `SELECT stm.team_id,
              COUNT(*) AS session_count,
              COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
       FROM season_team_members stm
       JOIN session_records sr ON sr.user_id = stm.user_id
         AND sr.started_at >= ?
         AND sr.started_at < ?
       WHERE stm.season_id = ?
         AND stm.team_id IN (${placeholders})
       GROUP BY stm.team_id`
    )
    .bind(req.fromDate, req.toDate, req.seasonId, ...req.teamIds)
    .all<TeamSessionStatsRow>();

  return Response.json({ data: results.results });
}

async function handleGetSeasonMemberSessionStats(
  req: GetSeasonMemberSessionStatsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.teamIds || req.teamIds.length === 0 || !req.fromDate || !req.toDate) {
    return Response.json(
      { error: "seasonId, teamIds, fromDate, and toDate are required" },
      { status: 400 }
    );
  }

  const placeholders = req.teamIds.map(() => "?").join(",");
  const results = await db
    .prepare(
      `SELECT stm.team_id,
              stm.user_id,
              COUNT(*) AS session_count,
              COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
       FROM season_team_members stm
       JOIN session_records sr ON sr.user_id = stm.user_id
         AND sr.started_at >= ?
         AND sr.started_at < ?
       WHERE stm.season_id = ?
         AND stm.team_id IN (${placeholders})
       GROUP BY stm.team_id, stm.user_id`
    )
    .bind(req.fromDate, req.toDate, req.seasonId, ...req.teamIds)
    .all<MemberSessionStatsRow>();

  return Response.json({ data: results.results });
}

async function handleGetSeasonTeamMembers(
  req: GetSeasonTeamMembersRequest,
  db: D1Database
): Promise<Response> {
  if (!req.teamId) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }

  const results = await db
    .prepare(`SELECT user_id FROM team_members WHERE team_id = ?`)
    .bind(req.teamId)
    .all<{ user_id: string }>();

  return Response.json({ data: results.results.map((r) => r.user_id) });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleSeasonsRpc(
  request: SeasonsRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "seasons.list":
      return handleListSeasons(db);
    case "seasons.getById":
      return handleGetSeasonById(request, db);
    case "seasons.getBySlug":
      return handleGetSeasonBySlug(request, db);
    case "seasons.getRegistration":
      return handleGetSeasonRegistration(request, db);
    case "seasons.checkMemberConflict":
      return handleCheckSeasonMemberConflict(request, db);
    case "seasons.getSnapshots":
      return handleGetSeasonSnapshots(request, db);
    case "seasons.getMemberSnapshots":
      return handleGetSeasonMemberSnapshots(request, db);
    case "seasons.getTeamTokens":
      return handleGetSeasonTeamTokens(request, db);
    case "seasons.getMemberTokens":
      return handleGetSeasonMemberTokens(request, db);
    case "seasons.getTeamSessionStats":
      return handleGetSeasonTeamSessionStats(request, db);
    case "seasons.getMemberSessionStats":
      return handleGetSeasonMemberSessionStats(request, db);
    case "seasons.getTeamMembers":
      return handleGetSeasonTeamMembers(request, db);
    default:
      return Response.json(
        { error: `Unknown seasons method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

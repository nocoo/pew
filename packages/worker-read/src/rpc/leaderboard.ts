/**
 * Leaderboard domain RPC handlers for worker-read.
 *
 * Handles leaderboard-related read queries.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface LeaderboardEntryRow {
  user_id: string;
  username: string;
  avatar_url: string | null;
  total_tokens: number;
  rank: number;
}

export interface TeamLeaderboardEntryRow {
  team_id: string;
  team_name: string;
  team_avatar_url: string | null;
  total_tokens: number;
  rank: number;
}

/** Global leaderboard entry row */
export interface GlobalLeaderboardRow {
  user_id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  slug: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

/** User team membership row */
export interface UserTeamMembershipRow {
  user_id: string;
  team_id: string;
  team_name: string;
  logo_url: string | null;
}

/** User session stats row */
export interface UserSessionStatsRow {
  user_id: string;
  session_count: number;
  total_duration_seconds: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetUserLeaderboardRequest {
  method: "leaderboard.getUsers";
  seasonId: string;
  limit?: number;
  offset?: number;
}

export interface GetTeamLeaderboardRequest {
  method: "leaderboard.getTeams";
  seasonId: string;
  limit?: number;
  offset?: number;
}

export interface GetUserRankRequest {
  method: "leaderboard.getUserRank";
  seasonId: string;
  userId: string;
}

export interface GetTeamRankRequest {
  method: "leaderboard.getTeamRank";
  seasonId: string;
  teamId: string;
}

/** Global leaderboard query request */
export interface GetGlobalLeaderboardRequest {
  method: "leaderboard.getGlobal";
  fromDate?: string;
  teamId?: string;
  orgId?: string;
  limit: number;
}

/** Get user teams request */
export interface GetUserTeamsRequest {
  method: "leaderboard.getUserTeams";
  userIds: string[];
}

/** Get user session stats request */
export interface GetUserSessionStatsRequest {
  method: "leaderboard.getUserSessionStats";
  userIds: string[];
  fromDate?: string;
}

export type LeaderboardRpcRequest =
  | GetUserLeaderboardRequest
  | GetTeamLeaderboardRequest
  | GetUserRankRequest
  | GetTeamRankRequest
  | GetGlobalLeaderboardRequest
  | GetUserTeamsRequest
  | GetUserSessionStatsRequest;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetUserLeaderboard(
  req: GetUserLeaderboardRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId) {
    return Response.json({ error: "seasonId is required" }, { status: 400 });
  }

  const limit = req.limit ?? 50;
  const offset = req.offset ?? 0;

  const sql = `
    SELECT
      ss.user_id,
      u.username,
      u.avatar_url,
      ss.total_tokens,
      RANK() OVER (ORDER BY ss.total_tokens DESC) AS rank
    FROM season_snapshots ss
    JOIN users u ON u.id = ss.user_id
    WHERE ss.season_id = ? AND ss.team_id IS NULL
    ORDER BY ss.total_tokens DESC
    LIMIT ? OFFSET ?
  `;

  const results = await db
    .prepare(sql)
    .bind(req.seasonId, limit, offset)
    .all<LeaderboardEntryRow>();

  return Response.json({ result: results.results });
}

async function handleGetTeamLeaderboard(
  req: GetTeamLeaderboardRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId) {
    return Response.json({ error: "seasonId is required" }, { status: 400 });
  }

  const limit = req.limit ?? 50;
  const offset = req.offset ?? 0;

  const sql = `
    SELECT
      t.id AS team_id,
      t.name AS team_name,
      t.avatar_url AS team_avatar_url,
      SUM(ss.total_tokens) AS total_tokens,
      RANK() OVER (ORDER BY SUM(ss.total_tokens) DESC) AS rank
    FROM season_snapshots ss
    JOIN teams t ON t.id = ss.team_id
    WHERE ss.season_id = ? AND ss.team_id IS NOT NULL
    GROUP BY t.id, t.name, t.avatar_url
    ORDER BY total_tokens DESC
    LIMIT ? OFFSET ?
  `;

  const results = await db
    .prepare(sql)
    .bind(req.seasonId, limit, offset)
    .all<TeamLeaderboardEntryRow>();

  return Response.json({ result: results.results });
}

async function handleGetUserRank(
  req: GetUserRankRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.userId) {
    return Response.json(
      { error: "seasonId and userId are required" },
      { status: 400 }
    );
  }

  const sql = `
    WITH ranked AS (
      SELECT
        user_id,
        total_tokens,
        RANK() OVER (ORDER BY total_tokens DESC) AS rank
      FROM season_snapshots
      WHERE season_id = ? AND team_id IS NULL
    )
    SELECT rank, total_tokens FROM ranked WHERE user_id = ?
  `;

  const result = await db
    .prepare(sql)
    .bind(req.seasonId, req.userId)
    .first<{ rank: number; total_tokens: number }>();

  return Response.json({ result: result });
}

async function handleGetTeamRank(
  req: GetTeamRankRequest,
  db: D1Database
): Promise<Response> {
  if (!req.seasonId || !req.teamId) {
    return Response.json(
      { error: "seasonId and teamId are required" },
      { status: 400 }
    );
  }

  const sql = `
    WITH team_totals AS (
      SELECT
        team_id,
        SUM(total_tokens) AS total_tokens
      FROM season_snapshots
      WHERE season_id = ? AND team_id IS NOT NULL
      GROUP BY team_id
    ),
    ranked AS (
      SELECT
        team_id,
        total_tokens,
        RANK() OVER (ORDER BY total_tokens DESC) AS rank
      FROM team_totals
    )
    SELECT rank, total_tokens FROM ranked WHERE team_id = ?
  `;

  const result = await db
    .prepare(sql)
    .bind(req.seasonId, req.teamId)
    .first<{ rank: number; total_tokens: number }>();

  return Response.json({ result: result });
}

// ---------------------------------------------------------------------------
// Global leaderboard handlers
// ---------------------------------------------------------------------------

async function handleGetGlobalLeaderboard(
  req: GetGlobalLeaderboardRequest,
  db: D1Database
): Promise<Response> {
  const conditions: string[] = ["u.is_public = 1"];
  const params: unknown[] = [];

  if (req.fromDate) {
    conditions.push("ur.hour_start >= ?");
    params.push(req.fromDate);
  }

  if (req.teamId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = ur.user_id AND tm.team_id = ?)"
    );
    params.push(req.teamId);
  }

  if (req.orgId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = ur.user_id AND om.org_id = ?)"
    );
    params.push(req.orgId);
  }

  params.push(req.limit);

  // Try with nickname column first
  const buildSql = (withNickname: boolean) => `
    SELECT
      ur.user_id,
      u.name,
      ${withNickname ? "u.nickname," : "NULL AS nickname,"}
      u.image,
      u.slug,
      SUM(ur.total_tokens) AS total_tokens,
      SUM(ur.input_tokens) AS input_tokens,
      SUM(ur.output_tokens) AS output_tokens,
      SUM(ur.cached_input_tokens) AS cached_input_tokens
    FROM usage_records ur
    JOIN users u ON u.id = ur.user_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY ur.user_id
    HAVING total_tokens > 0
    ORDER BY total_tokens DESC
    LIMIT ?
  `;

  try {
    const results = await db
      .prepare(buildSql(true))
      .bind(...params)
      .all<GlobalLeaderboardRow>();
    return Response.json({ result: results.results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("no such column") && !msg.includes("no such table")) {
      throw err;
    }
    // Retry without nickname
    const results = await db
      .prepare(buildSql(false))
      .bind(...params)
      .all<GlobalLeaderboardRow>();
    return Response.json({ result: results.results });
  }
}

async function handleGetUserTeams(
  req: GetUserTeamsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userIds || req.userIds.length === 0) {
    return Response.json({ result: [] });
  }

  const placeholders = req.userIds.map(() => "?").join(",");
  const sql = `
    SELECT tm.user_id, t.id AS team_id, t.name AS team_name, t.logo_url
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id IN (${placeholders})
  `;

  try {
    const results = await db
      .prepare(sql)
      .bind(...req.userIds)
      .all<UserTeamMembershipRow>();
    return Response.json({ result: results.results });
  } catch {
    // Silently return empty if tables don't exist
    return Response.json({ result: [] });
  }
}

async function handleGetUserSessionStats(
  req: GetUserSessionStatsRequest,
  db: D1Database
): Promise<Response> {
  if (!req.userIds || req.userIds.length === 0) {
    return Response.json({ result: [] });
  }

  const placeholders = req.userIds.map(() => "?").join(",");
  const conditions = [`sr.user_id IN (${placeholders})`];
  const params: unknown[] = [...req.userIds];

  if (req.fromDate) {
    conditions.push("sr.started_at >= ?");
    params.push(req.fromDate);
  }

  const sql = `
    SELECT sr.user_id,
           COUNT(*) AS session_count,
           COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
    FROM session_records sr
    WHERE ${conditions.join(" AND ")}
    GROUP BY sr.user_id
  `;

  try {
    const results = await db
      .prepare(sql)
      .bind(...params)
      .all<UserSessionStatsRow>();
    return Response.json({ result: results.results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return Response.json({ result: [] });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleLeaderboardRpc(
  request: LeaderboardRpcRequest,
  db: D1Database
): Promise<Response> {
  switch (request.method) {
    case "leaderboard.getUsers":
      return handleGetUserLeaderboard(request, db);
    case "leaderboard.getTeams":
      return handleGetTeamLeaderboard(request, db);
    case "leaderboard.getUserRank":
      return handleGetUserRank(request, db);
    case "leaderboard.getTeamRank":
      return handleGetTeamRank(request, db);
    case "leaderboard.getGlobal":
      return handleGetGlobalLeaderboard(request, db);
    case "leaderboard.getUserTeams":
      return handleGetUserTeams(request, db);
    case "leaderboard.getUserSessionStats":
      return handleGetUserSessionStats(request, db);
    default:
      return Response.json(
        { error: `Unknown leaderboard method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

/**
 * Leaderboard domain RPC handlers for worker-read.
 *
 * Handles leaderboard-related read queries.
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { withCache, TTL_10M } from "../cache";
import type {
  GetGlobalLeaderboardRequest, GetTeamLeaderboardRequest, GetTeamRankRequest,
  GetUserLeaderboardRequest, GetUserRankRequest, GetUserSessionStatsRequest,
  GetUserTeamsRequest, GlobalLeaderboardRow, LeaderboardEntryRow, LeaderboardRpcRequest,
  TeamLeaderboardEntryRow, UserSessionStatsRow, UserTeamMembershipRow,
} from "./leaderboard-types";
export type * from "./leaderboard-types";

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

  const limit = Math.min(req.limit ?? 50, 250);
  const offset = req.offset ?? 0;

  const sql = `
    SELECT
      ss.user_id,
      u.name,
      u.image,
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

  const limit = Math.min(req.limit ?? 50, 250);
  const offset = req.offset ?? 0;

  const sql = `
    SELECT
      t.id AS team_id,
      t.name AS team_name,
      t.logo_url,
      SUM(ss.total_tokens) AS total_tokens,
      RANK() OVER (ORDER BY SUM(ss.total_tokens) DESC) AS rank
    FROM season_snapshots ss
    JOIN teams t ON t.id = ss.team_id
    WHERE ss.season_id = ? AND ss.team_id IS NOT NULL
    GROUP BY t.id, t.name, t.logo_url
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
  const conditions: string[] = ["(ur.event_id = '' OR ur.total_tokens > 0)"];
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

  if (req.source) {
    conditions.push("ur.source = ?");
    params.push(req.source);
  }

  if (req.model) {
    conditions.push("ur.model = ?");
    params.push(req.model);
  }

  params.push(req.limit);
  const offset = req.offset ?? 0;
  params.push(offset);

  // Try with nickname column first
  const buildSql = (withNickname: boolean) => `
    WITH totals AS (
      SELECT ur.user_id,
        SUM(ur.total_tokens) AS total_tokens,
        SUM(ur.input_tokens) AS input_tokens,
        SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens
      FROM usage_bases ur
      WHERE ${conditions.join(" AND ")}
      GROUP BY ur.user_id
    )
    SELECT ur.user_id, u.name,
      ${withNickname ? "u.nickname," : "NULL AS nickname,"}
      u.image, u.slug,
      ur.total_tokens, ur.input_tokens, ur.output_tokens, ur.cached_input_tokens
    FROM totals ur
    JOIN users u ON u.id = ur.user_id
    WHERE u.is_public = 1 AND ur.total_tokens > 0
    ORDER BY ur.total_tokens DESC
    LIMIT ? OFFSET ?
  `;

  // Helper to fetch leaderboard from D1
  const fetchLeaderboard = async () => {
    try {
      const results = await db
        .prepare(buildSql(true))
        .bind(...params)
        .all<GlobalLeaderboardRow>();
      return results.results;
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
      return results.results;
    }
  };

  const data = await fetchLeaderboard();
  return Response.json({ result: data, _cached: false });
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
  db: D1Database,
  kv: KVNamespace
): Promise<Response> {
  if (!req.userIds || req.userIds.length === 0) {
    return Response.json({ result: [] });
  }

  const userIds = [...new Set(req.userIds)].sort();
  // Hash the full filter tuple: 100 UUIDs exceed KV's 512-byte key limit.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    JSON.stringify([userIds, req.fromDate ?? "", req.source ?? ""])
  ));
  const cacheKey = `lb:sessions:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const placeholders = userIds.map(() => "?").join(",");
  const conditions = [`sr.user_id IN (${placeholders})`];
  const params: unknown[] = [...userIds];

  if (req.fromDate) {
    conditions.push("sr.started_at >= ?");
    params.push(req.fromDate);
  }

  if (req.source) {
    conditions.push("sr.source = ?");
    params.push(req.source);
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
    const { data } = await withCache(kv, cacheKey, async () => {
      const results = await db.prepare(sql).bind(...params).all<UserSessionStatsRow>();
      return results.results;
    }, { ttlSeconds: TTL_10M });
    return Response.json({ result: data });
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
  db: D1Database,
  kv: KVNamespace
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
      return handleGetUserSessionStats(request, db, kv);
    default:
      return Response.json(
        { error: `Unknown leaderboard method: ${(request as { method: string }).method}` },
        { status: 400 }
      );
  }
}

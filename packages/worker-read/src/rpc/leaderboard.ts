/**
 * Leaderboard domain RPC handlers for worker-read.
 *
 * Handles leaderboard-related read queries.
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { getLeaderboardRevision, getLeaderboardSnapshot } from "../leaderboard-snapshot";
import type {
  GetTeamLeaderboardRequest,
  GetTeamRankRequest,
  GetUserLeaderboardRequest,
  GetUserRankRequest,
  LeaderboardEntryRow,
  LeaderboardRpcRequest,
  TeamLeaderboardEntryRow,
} from "./leaderboard-types";
export type * from "./leaderboard-types";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetUserLeaderboard(
  req: GetUserLeaderboardRequest,
  db: D1Database,
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
  db: D1Database,
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

async function handleGetUserRank(req: GetUserRankRequest, db: D1Database): Promise<Response> {
  if (!req.seasonId || !req.userId) {
    return Response.json({ error: "seasonId and userId are required" }, { status: 400 });
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

async function handleGetTeamRank(req: GetTeamRankRequest, db: D1Database): Promise<Response> {
  if (!req.seasonId || !req.teamId) {
    return Response.json({ error: "seasonId and teamId are required" }, { status: 400 });
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
// Router
// ---------------------------------------------------------------------------

export async function handleLeaderboardRpc(
  request: LeaderboardRpcRequest,
  db: D1Database,
  kv: KVNamespace,
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
    case "leaderboard.getRevision":
      return Response.json({ result: await getLeaderboardRevision(db) });
    case "leaderboard.getSnapshot":
      return Response.json({ result: await getLeaderboardSnapshot(request, db, kv) });
    default:
      return Response.json(
        { error: `Unknown leaderboard method: ${(request as { method: string }).method}` },
        { status: 400 },
      );
  }
}

/**
 * GET /api/leaderboard — public leaderboard rankings.
 *
 * Query params:
 *   period — "week" | "month" | "all" (default: "week")
 *   limit  — max entries to return (default: 10 public / 50 admin, max: 100)
 *   team   — team ID for team-scoped leaderboard (optional)
 *   admin  — "true" to bypass public filter (requires admin auth)
 *
 * Returns { period, entries[] } where each entry has user info + total tokens.
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { resolveAdmin } from "@/lib/admin";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_PERIODS = new Set(["week", "month", "all"]);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 100;
const ADMIN_DEFAULT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardRow {
  user_id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  slug: string | null;
  is_public: number | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

interface SessionStatsRow {
  user_id: string;
  session_count: number;
  total_duration_seconds: number;
}

interface UserTeamRow {
  user_id: string;
  team_id: string;
  team_name: string;
  logo_url: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodStartDate(period: string): string | null {
  if (period === "all") return null;

  const now = new Date();
  if (period === "week") {
    now.setDate(now.getDate() - 7);
  } else {
    // month
    now.setDate(now.getDate() - 30);
  }
  return now.toISOString();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "week";
  const limitParam = url.searchParams.get("limit");
  const teamId = url.searchParams.get("team");
  const adminParam = url.searchParams.get("admin");

  // Validate period
  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: `Invalid period: "${period}". Use week, month, or all.` },
      { status: 400 },
    );
  }

  // Validate limit
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return NextResponse.json(
        { error: `limit must be 1-${MAX_LIMIT}` },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  // Admin mode: bypass public filters if caller is a verified admin
  let isAdminMode = false;
  if (adminParam === "true") {
    const admin = await resolveAdmin(request);
    isAdminMode = admin !== null;
    // Admin defaults to higher limit when no explicit limit is set
    if (isAdminMode && !limitParam) {
      limit = ADMIN_DEFAULT_LIMIT;
    }
  }

  const db = await getDbRead();
  const fromDate = periodStartDate(period);

  const conditions = ["1=1"];
  const params: unknown[] = [];

  if (fromDate) {
    conditions.push("ur.hour_start >= ?");
    params.push(fromDate);
  }

  // Team filter: only include team members (requires teams tables to exist)
  let teamJoin = "";
  if (teamId) {
    teamJoin = "JOIN team_members tm ON tm.user_id = ur.user_id";
    conditions.push("tm.team_id = ?");
    params.push(teamId);
  } else if (!isAdminMode) {
    // Public leaderboard only shows users who opted in
    conditions.push("u.is_public = 1");
  }

  params.push(limit);

  // Try with nickname column first, fall back without it
  const buildSql = (withNickname: boolean) => `
    SELECT
      ur.user_id,
      u.name,
      ${withNickname ? "u.nickname," : ""}
      u.image,
      u.slug,
      ${isAdminMode ? "u.is_public," : ""}
      SUM(ur.total_tokens) AS total_tokens,
      SUM(ur.input_tokens) AS input_tokens,
      SUM(ur.output_tokens) AS output_tokens,
      SUM(ur.cached_input_tokens) AS cached_input_tokens
    FROM usage_records ur
    JOIN users u ON u.id = ur.user_id
    ${teamJoin}
    WHERE ${conditions.join(" AND ")}
    GROUP BY ur.user_id
    HAVING total_tokens > 0
    ORDER BY total_tokens DESC
    LIMIT ?
  `;

  try {
    let result: { results: LeaderboardRow[] };
    try {
      result = await db.query<LeaderboardRow>(buildSql(true), params);
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : "";
      if (!msg.includes("no such column") && !msg.includes("no such table")) {
        throw firstErr;
      }

      // Level 1: retry without nickname (keeps is_public, admin, team semantics)
      try {
        result = await db.query<LeaderboardRow>(buildSql(false), params);
      } catch (secondErr) {
        const msg2 = secondErr instanceof Error ? secondErr.message : "";
        if (!msg2.includes("no such column") && !msg2.includes("no such table")) {
          throw secondErr;
        }

        // Level 2: strip everything new — no nickname, no is_public, no team join.
        // This is the pre-migration baseline: slug IS NOT NULL only.
        const bareConditions = ["1=1"];
        const bareParams: unknown[] = [];
        if (fromDate) {
          bareConditions.push("ur.hour_start >= ?");
          bareParams.push(fromDate);
        }
        bareParams.push(limit);

        const bareSql = `
          SELECT
            ur.user_id,
            u.name,
            u.image,
            u.slug,
            SUM(ur.total_tokens) AS total_tokens,
            SUM(ur.input_tokens) AS input_tokens,
            SUM(ur.output_tokens) AS output_tokens,
            SUM(ur.cached_input_tokens) AS cached_input_tokens
          FROM usage_records ur
          JOIN users u ON u.id = ur.user_id
          WHERE ${bareConditions.join(" AND ")}
          GROUP BY ur.user_id
          HAVING total_tokens > 0
          ORDER BY total_tokens DESC
          LIMIT ?
        `;
        result = await db.query<LeaderboardRow>(bareSql, bareParams);
      }
    }

    // Fetch teams for all users in the leaderboard
    const userIds = result.results.map((r) => r.user_id);
    const teamsByUser = new Map<string, { id: string; name: string; logo_url: string | null }[]>();

    if (userIds.length > 0) {
      try {
        const placeholders = userIds.map(() => "?").join(",");
        const teamResult = await db.query<UserTeamRow>(
          `SELECT tm.user_id, t.id AS team_id, t.name AS team_name, t.logo_url
           FROM team_members tm
           JOIN teams t ON t.id = tm.team_id
           WHERE tm.user_id IN (${placeholders})`,
          userIds,
        );
        for (const row of teamResult.results) {
          const list = teamsByUser.get(row.user_id) ?? [];
          list.push({ id: row.team_id, name: row.team_name, logo_url: row.logo_url ?? null });
          teamsByUser.set(row.user_id, list);
        }
      } catch {
        // Silently skip if teams tables don't exist yet
      }
    }

    // Fetch session stats for all users in the leaderboard
    const sessionStatsByUser = new Map<string, { session_count: number; total_duration_seconds: number }>();

    if (userIds.length > 0) {
      try {
        const placeholders = userIds.map(() => "?").join(",");
        const sessionConditions = [`sr.user_id IN (${placeholders})`];
        const sessionParams: unknown[] = [...userIds];

        if (fromDate) {
          sessionConditions.push("sr.started_at >= ?");
          sessionParams.push(fromDate);
        }

        const sessionResult = await db.query<SessionStatsRow>(
          `SELECT sr.user_id,
                  COUNT(*) AS session_count,
                  COALESCE(SUM(sr.duration_seconds), 0) AS total_duration_seconds
           FROM session_records sr
           WHERE ${sessionConditions.join(" AND ")}
           GROUP BY sr.user_id`,
          sessionParams,
        );
        for (const row of sessionResult.results) {
          sessionStatsByUser.set(row.user_id, {
            session_count: row.session_count,
            total_duration_seconds: row.total_duration_seconds,
          });
        }
      } catch {
        // Silently skip if session_records table doesn't exist yet
      }
    }

    const entries = result.results.map((row, index) => {
      const sessionStats = sessionStatsByUser.get(row.user_id);
      return {
        rank: index + 1,
        user: {
          id: row.user_id,
          name: row.nickname ?? row.name,
          image: row.image,
          slug: row.slug,
          ...(isAdminMode && {
            is_public: row.is_public == null ? null : row.is_public === 1,
          }),
        },
        teams: teamsByUser.get(row.user_id) ?? [],
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_input_tokens: row.cached_input_tokens,
        session_count: sessionStats?.session_count ?? 0,
        total_duration_seconds: sessionStats?.total_duration_seconds ?? 0,
      };
    });

    const headers: HeadersInit = isAdminMode || teamId
      ? { "Cache-Control": "private, no-store" }
      : { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };

    return NextResponse.json({ period, entries }, { headers });
  } catch (err) {
    console.error("Failed to query leaderboard:", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 },
    );
  }
}

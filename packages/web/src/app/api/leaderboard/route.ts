/**
 * GET /api/leaderboard — public leaderboard rankings.
 *
 * Query params:
 *   period — "week" | "month" | "all" (default: "week")
 *   limit  — max entries to return (default: 100, max: 100)
 *   team   — team ID for team-scoped leaderboard (optional, mutually exclusive with org)
 *   org    — organization ID for org-scoped leaderboard (optional, mutually exclusive with team)
 *
 * Returns { period, scope, scopeId?, entries[] } where each entry has user info + total tokens.
 * Only users with is_public = 1 are included.
 *
 * Scoped requests use Cache-Control: private, no-store.
 * Anonymous requests with scope params are silently downgraded to global.
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { resolveUser } from "@/lib/auth-helpers";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_PERIODS = new Set(["week", "month", "all"]);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardRow {
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
  const teamIdParam = url.searchParams.get("team");
  const orgIdParam = url.searchParams.get("org");

  // Validate period
  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: `Invalid period: "${period}". Use week, month, or all.` },
      { status: 400 },
    );
  }

  // Validate: org and team are mutually exclusive
  if (teamIdParam && orgIdParam) {
    return NextResponse.json(
      { error: "Cannot specify both team and org parameters" },
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

  // Check auth for scoped requests — anonymous users silently degrade to global
  let teamId: string | null = null;
  let orgId: string | null = null;

  if (teamIdParam || orgIdParam) {
    const authResult = await resolveUser(request);
    if (authResult) {
      teamId = teamIdParam;
      orgId = orgIdParam;
    }
    // else: silently ignore scope params for anonymous users
  }

  const db = await getDbRead();
  const fromDate = periodStartDate(period);

  const conditions = ["1=1"];
  const params: unknown[] = [];

  if (fromDate) {
    conditions.push("ur.hour_start >= ?");
    params.push(fromDate);
  }

  // Team filter using EXISTS (no fan-out)
  if (teamId) {
    conditions.push("EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = ur.user_id AND tm.team_id = ?)");
    params.push(teamId);
  }

  // Organization filter using EXISTS (no fan-out)
  if (orgId) {
    conditions.push("EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = ur.user_id AND om.org_id = ?)");
    params.push(orgId);
  }

  // Always filter by is_public = 1 (opt-out respected)
  conditions.push("u.is_public = 1");

  params.push(limit);

  // Try with nickname column first, fall back without it
  const buildSql = (withNickname: boolean) => `
    SELECT
      ur.user_id,
      u.name,
      ${withNickname ? "u.nickname," : ""}
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
    let result: { results: LeaderboardRow[] };
    try {
      result = await db.query<LeaderboardRow>(buildSql(true), params);
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : "";
      if (!msg.includes("no such column") && !msg.includes("no such table")) {
        throw firstErr;
      }

      // Level 1: retry without nickname (keeps is_public and team semantics)
      // If this also fails, fail closed — do not bypass opt-out filters
      result = await db.query<LeaderboardRow>(buildSql(false), params);
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
    // Batch to avoid D1's 999 parameter limit (100 UUIDs × ~1 param each + date = safe)
    const sessionStatsByUser = new Map<string, { session_count: number; total_duration_seconds: number }>();
    const BATCH_SIZE = 50;

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      if (batch.length === 0) continue;

      try {
        const placeholders = batch.map(() => "?").join(",");
        const sessionConditions = [`sr.user_id IN (${placeholders})`];
        const sessionParams: unknown[] = [...batch];

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
      } catch (err) {
        // Silently skip if session_records table doesn't exist yet
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("no such table")) {
          console.error("Failed to fetch session stats batch:", err);
        }
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

    // Determine scope for response
    const scope = orgId ? "org" : teamId ? "team" : "global";
    const scopeId = orgId ?? teamId ?? undefined;

    // Cache policy: any request with scope params (even anonymous, degraded to global)
    // must use private, no-store to prevent cache pollution.
    // Only truly global requests (no scope params at all) can be publicly cached.
    const hasAnyScopeParam = !!(teamIdParam || orgIdParam);
    const headers: HeadersInit = hasAnyScopeParam
      ? { "Cache-Control": "private, no-store" }
      : { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };

    return NextResponse.json(
      { period, scope, ...(scopeId && { scopeId }), entries },
      { headers },
    );
  } catch (err) {
    console.error("Failed to query leaderboard:", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 },
    );
  }
}

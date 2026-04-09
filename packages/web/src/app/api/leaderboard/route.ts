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
// Helpers
// ---------------------------------------------------------------------------

function periodStartDate(period: string): string | undefined {
  if (period === "all") return undefined;

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
  let teamId: string | undefined;
  let orgId: string | undefined;

  if (teamIdParam || orgIdParam) {
    const authResult = await resolveUser(request);
    if (authResult) {
      teamId = teamIdParam ?? undefined;
      orgId = orgIdParam ?? undefined;
    }
    // else: silently ignore scope params for anonymous users
  }

  const db = await getDbRead();
  const fromDate = periodStartDate(period);

  try {
    // Get main leaderboard entries via RPC
    const leaderboardRows = await db.getGlobalLeaderboard({
      ...(fromDate !== undefined && { fromDate }),
      ...(teamId !== undefined && { teamId }),
      ...(orgId !== undefined && { orgId }),
      limit,
    });

    // Fetch teams for all users in the leaderboard
    const userIds = leaderboardRows.map((r) => r.user_id);
    const teamsByUser = new Map<string, { id: string; name: string; logo_url: string | null }[]>();

    if (userIds.length > 0) {
      const teamRows = await db.getLeaderboardUserTeams(userIds);
      for (const row of teamRows) {
        const list = teamsByUser.get(row.user_id) ?? [];
        list.push({ id: row.team_id, name: row.team_name, logo_url: row.logo_url ?? null });
        teamsByUser.set(row.user_id, list);
      }
    }

    // Fetch session stats for all users (batch to avoid Worker timeout)
    const sessionStatsByUser = new Map<string, { session_count: number; total_duration_seconds: number }>();

    if (userIds.length > 0) {
      // Batch in chunks of 20 to match frontend page size and avoid Worker CPU timeout
      const BATCH_SIZE = 20;
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        const sessionRows = await db.getLeaderboardSessionStats(batch, fromDate);
        for (const row of sessionRows) {
          sessionStatsByUser.set(row.user_id, {
            session_count: row.session_count,
            total_duration_seconds: row.total_duration_seconds,
          });
        }
      }
    }

    const entries = leaderboardRows.map((row, index) => {
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

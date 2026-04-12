/**
 * GET /api/leaderboard — public leaderboard rankings.
 *
 * Query params:
 *   period — "week" | "month" | "all" (default: "week")
 *   limit  — max entries to return (default: 20, max: 100)
 *   offset — number of entries to skip for pagination (default: 0)
 *   team   — team ID for team-scoped leaderboard (optional, mutually exclusive with org)
 *   org    — organization ID for org-scoped leaderboard (optional, mutually exclusive with team)
 *   source — filter by agent source slug (optional, mutually exclusive with model)
 *   model  — filter by model name (optional, mutually exclusive with source)
 *
 * Returns { period, scope, scopeId?, entries[], hasMore } where each entry has user info + total tokens.
 * Only users with is_public = 1 are included.
 *
 * Scoped requests (team/org) use Cache-Control: private, no-store.
 * source/model filters are identity-independent → public cache.
 * Anonymous requests with scope params are silently downgraded to global.
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { resolveUser } from "@/lib/auth-helpers";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_PERIODS = new Set(["week", "month", "all"]);
const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "copilot-cli",
  "gemini-cli",
  "hermes",
  "kosmos",
  "opencode",
  "openclaw",
  "pi",
  "pmstudio",
  "vscode-copilot",
]);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

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
  const offsetParam = url.searchParams.get("offset");
  const teamIdParam = url.searchParams.get("team");
  const orgIdParam = url.searchParams.get("org");
  const sourceFilter = url.searchParams.get("source");
  const modelFilter = url.searchParams.get("model");

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

  // Validate: source and model are mutually exclusive
  if (sourceFilter && modelFilter) {
    return NextResponse.json(
      { error: "Cannot specify both source and model parameters" },
      { status: 400 },
    );
  }

  // Validate source filter
  if (sourceFilter && !VALID_SOURCES.has(sourceFilter)) {
    return NextResponse.json(
      { error: `Invalid source: "${sourceFilter}"` },
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

  // Validate offset
  let offset = 0;
  if (offsetParam) {
    const parsed = parseInt(offsetParam, 10);
    if (isNaN(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "offset must be a non-negative integer" },
        { status: 400 },
      );
    }
    offset = parsed;
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
    // Request one extra to detect if there are more pages
    const leaderboardRows = await db.getGlobalLeaderboard({
      ...(fromDate !== undefined && { fromDate }),
      ...(teamId !== undefined && { teamId }),
      ...(orgId !== undefined && { orgId }),
      ...(sourceFilter && { source: sourceFilter }),
      ...(modelFilter && { model: modelFilter }),
      limit: limit + 1,
      ...(offset > 0 && { offset }),
    });

    // Check if there are more results
    const hasMore = leaderboardRows.length > limit;
    const actualRows = hasMore ? leaderboardRows.slice(0, limit) : leaderboardRows;

    // Fetch teams for all users in the leaderboard
    const userIds = actualRows.map((r) => r.user_id);
    const teamsByUser = new Map<string, { id: string; name: string; logo_url: string | null }[]>();

    if (userIds.length > 0) {
      const teamRows = await db.getLeaderboardUserTeams(userIds);
      for (const row of teamRows) {
        const list = teamsByUser.get(row.user_id) ?? [];
        list.push({ id: row.team_id, name: row.team_name, logo_url: row.logo_url ?? null });
        teamsByUser.set(row.user_id, list);
      }
    }

    // Fetch active badges for all users
    const badgesByUser =
      userIds.length > 0
        ? await db.getActiveBadgesForUsers(userIds)
        : {};

    // Fetch session stats for all users
    // When model filter is active, session stats are not meaningful (session_records
    // has no reliable model column) — return null to signal "not applicable".
    const skipSessionStats = !!modelFilter;
    const sessionStatsByUser = new Map<string, { session_count: number; total_duration_seconds: number }>();

    if (userIds.length > 0 && !skipSessionStats) {
      const sessionRows = await db.getLeaderboardSessionStats(
        userIds,
        fromDate,
        sourceFilter ?? undefined,
      );
      for (const row of sessionRows) {
        sessionStatsByUser.set(row.user_id, {
          session_count: row.session_count,
          total_duration_seconds: row.total_duration_seconds,
        });
      }
    }

    const entries = actualRows.map((row, index) => {
      const sessionStats = skipSessionStats ? null : sessionStatsByUser.get(row.user_id);
      const userBadges = badgesByUser[row.user_id] ?? [];
      return {
        rank: offset + index + 1,
        user: {
          id: row.user_id,
          name: row.nickname ?? row.name,
          image: row.image,
          slug: row.slug,
        },
        teams: teamsByUser.get(row.user_id) ?? [],
        badges: userBadges.map((b) => ({
          text: b.text,
          icon: b.icon,
          colorBg: b.color_bg,
          colorText: b.color_text,
        })),
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_input_tokens: row.cached_input_tokens,
        session_count: skipSessionStats ? null : (sessionStats?.session_count ?? 0),
        total_duration_seconds: skipSessionStats ? null : (sessionStats?.total_duration_seconds ?? 0),
      };
    });

    // Determine scope for response
    const scope = orgId ? "org" : teamId ? "team" : "global";
    const scopeId = orgId ?? teamId ?? undefined;

    // Cache policy: team/org scoped requests must use private, no-store to prevent
    // cache pollution (depends on user membership). Source/model filters are
    // identity-independent (public data), so they use public cache like global.
    const hasAnyScopeParam = !!(teamIdParam || orgIdParam);
    const headers: HeadersInit = hasAnyScopeParam
      ? { "Cache-Control": "private, no-store" }
      : { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };

    return NextResponse.json(
      { period, scope, ...(scopeId && { scopeId }), entries, hasMore },
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

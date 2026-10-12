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
 *   snapshot — snapshot ID from the first page (optional)
 *
 * Returns { period, scope, scopeId?, entries[], hasMore } where each entry has user info + total tokens.
 * Only users with is_public = 1 are included.
 *
 * Responses cannot be cached by HTTP intermediaries because public visibility is revocable.
 * Anonymous requests with scope params are silently downgraded to global.
 */

import { MAX_STRING_LENGTH, VALID_SOURCES } from "@pew/core";
import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { resolveUser } from "@/lib/auth-helpers";
import { isAdminUser } from "@/lib/admin";
import { getCachedLeaderboard } from "@/lib/leaderboard-cache";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_PERIODS = new Set(["week", "month", "all"]);

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodStartDate(period: string): string | undefined {
  if (period === "all") return undefined;

  // Keep both token and session queries on the same reusable UTC window.
  const windowMs = 10 * 60 * 1000;
  const now = Math.floor(Date.now() / windowMs) * windowMs;
  const days = period === "week" ? 7 : 30;
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
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
  const snapshotId = url.searchParams.get("snapshot");

  // Validate period
  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: "Invalid period parameter. Use week, month, or all." },
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
      { error: "Invalid source parameter" },
      { status: 400 },
    );
  }

  if (modelFilter && modelFilter.length > MAX_STRING_LENGTH) {
    return NextResponse.json(
      { error: `model must be at most ${MAX_STRING_LENGTH} characters` },
      { status: 400 },
    );
  }

  if (snapshotId !== null && !/^[a-zA-Z0-9:-]{1,128}$/.test(snapshotId)) {
    return NextResponse.json(
      { error: "snapshot must be 1-128 alphanumeric, colon or hyphen characters" },
      { status: 400 },
    );
  }

  // Validate limit
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (!/^\d+$/.test(limitParam) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
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
    const parsed = Number(offsetParam);
    if (!/^\d+$/.test(offsetParam) || !Number.isSafeInteger(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "offset must be a non-negative integer" },
        { status: 400 },
      );
    }
    offset = parsed;
  }

  try {
    const db = await getDbRead();
    let teamId: string | undefined;
    let orgId: string | undefined;
    let authorizedRevision: string | undefined;

    if (teamIdParam || orgIdParam) {
      // Bind live authorization to the same revision as the returned snapshot.
      const beforeAuth = await db.getLeaderboardRevision();
      const authResult = await resolveUser(request);
      if (authResult) {
        authorizedRevision = beforeAuth;
        const isAdmin = await isAdminUser(authResult);

        if (teamIdParam) {
          const isMember = isAdmin || await db.checkTeamMembershipExists(teamIdParam, authResult.userId);
          if (!isMember) {
            return NextResponse.json(
              { error: "Not a member of this team" },
              { status: 403, headers: { "Cache-Control": "private, no-store" } },
            );
          }
          teamId = teamIdParam;
        }
        if (orgIdParam) {
          const isMember = isAdmin || await db.checkOrgMembership(orgIdParam, authResult.userId);
          if (!isMember) {
            return NextResponse.json(
              { error: "Not a member of this organization" },
              { status: 403, headers: { "Cache-Control": "private, no-store" } },
            );
          }
          orgId = orgIdParam;
        }
      }
    }

    const fromDate = periodStartDate(period);
    const snapshot = await getCachedLeaderboard(db, {
      ...(fromDate !== undefined && { fromDate }),
      ...(teamId !== undefined && { teamId }),
      ...(orgId !== undefined && { orgId }),
      ...(sourceFilter && { source: sourceFilter }),
      ...(modelFilter && { model: modelFilter }),
    });

    if ((snapshotId !== null && snapshotId !== snapshot.id)
      || (authorizedRevision !== undefined && authorizedRevision !== snapshot.revision)) {
      return NextResponse.json(
        { error: "Leaderboard changed. Restart pagination.", code: "LEADERBOARD_CHANGED" },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const hasMore = offset + limit < snapshot.rows.length;
    const actualRows = snapshot.rows.slice(offset, offset + limit);

    const entries = actualRows.map((row, index) => {
      return {
        rank: offset + index + 1,
        user: {
          id: row.user_id,
          name: row.nickname ?? row.name,
          image: row.image,
          slug: row.slug,
        },
        teams: row.teams,
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cached_input_tokens: row.cached_input_tokens,
        session_count: row.session_count,
        total_duration_seconds: row.total_duration_seconds,
      };
    });

    // Determine scope for response
    const scope = orgId ? "org" : teamId ? "team" : "global";
    const scopeId = orgId ?? teamId ?? undefined;

    return NextResponse.json(
      {
        period, scope, ...(scopeId && { scopeId }), entries, hasMore,
        snapshotId: snapshot.id, generatedAt: snapshot.generatedAt, expiresAt: snapshot.expiresAt,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("Failed to query leaderboard:", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

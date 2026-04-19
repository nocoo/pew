/**
 * GET /api/users/[slug] — profile data for a user.
 *
 * Public profiles (is_public=1) are accessible without auth.
 * Private profiles require the caller to be:
 *   - an admin, OR
 *   - a teammate of the target user, OR
 *   - a participant in the same season as the target user
 *
 * Query params:
 *   days   — number of days to look back (default: 30, max: 365)
 *   from   — start datetime (ISO 8601, exclusive of days param if provided)
 *   to     — end datetime (ISO 8601, exclusive of days param if provided)
 *   source — filter by source (optional)
 *
 * Returns { user, records, summary }.
 */

import { NextResponse } from "next/server";
import { getDbRead, type DbRead } from "@/lib/db";
import { resolveUser } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/admin";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

// ---------------------------------------------------------------------------
// Authorization: bypass is_public
// ---------------------------------------------------------------------------

/**
 * Check whether the authenticated caller may view a non-public profile.
 *
 * Returns true if the caller is:
 *   1. an admin, OR
 *   2. on the same team as the target user, OR
 *   3. in the same season as the target user (both via registered teams)
 */
async function canBypassPublic(
  request: Request,
  db: DbRead,
  targetUserId: string,
): Promise<boolean> {
  const auth = await resolveUser(request);
  if (!auth) return false;

  // 1. Admin bypass
  if (isAdmin(auth.email)) return true;

  // 2. Teammate check — caller and target share at least one team
  try {
    const shared = await db.checkSharedTeam(auth.userId, targetUserId);
    if (shared) return true;
  } catch {
    // team_members table may not exist — graceful fallthrough
  }

  // 3. Same-season check — both users belong to teams registered in the same season
  try {
    const shared = await db.checkSharedSeason(auth.userId, targetUserId);
    if (shared) return true;
  } catch {
    // season_teams table may not exist — graceful fallthrough
  }

  return false;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // 1. Validate slug format (alphanumeric + hyphens, 1-64 chars) OR UUID
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
  if (!SLUG_RE.test(slug) && !UUID_RE.test(slug)) {
    return NextResponse.json(
      { error: "Invalid profile identifier" },
      { status: 400 },
    );
  }

  const db = await getDbRead();

  // 2. Look up user by slug or id
  const user = await db.getPublicUserBySlugOrId(slug);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Return 404 if user is not public — unless caller has access
  if (!user.is_public) {
    const allowed = await canBypassPublic(request, db, user.id);
    if (!allowed) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  }

  // 3. Parse query params
  const url = new URL(request.url);
  const daysParam = url.searchParams.get("days");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const sourceFilter = url.searchParams.get("source");

  // Determine time range: from/to takes precedence over days
  let fromDate: Date;
  let toDate: Date;

  if (fromParam && toParam) {
    // Use exact time range
    fromDate = new Date(fromParam);
    toDate = new Date(toParam);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid from/to datetime format" },
        { status: 400 },
      );
    }
  } else {
    // Use days-based range
    let days = DEFAULT_DAYS;
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > MAX_DAYS) {
        return NextResponse.json(
          { error: `days must be 1-${MAX_DAYS}` },
          { status: 400 },
        );
      }
      days = parsed;
    }
    fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    toDate = new Date(); // Default to now
  }

  if (sourceFilter && !VALID_SOURCES.has(sourceFilter)) {
    return NextResponse.json(
      { error: "Invalid source parameter" },
      { status: 400 },
    );
  }

  // 4. Execute query via RPC
  try {
    const records = await db.getUsageRecords(
      user.id,
      fromDate.toISOString(),
      toDate.toISOString(),
      {
        ...(sourceFilter && { source: sourceFilter }),
        granularity: "day",
      },
    );

    // Compute summary
    const summary = records.reduce(
      (acc, r) => ({
        input_tokens: acc.input_tokens + r.input_tokens,
        cached_input_tokens: acc.cached_input_tokens + r.cached_input_tokens,
        output_tokens: acc.output_tokens + r.output_tokens,
        reasoning_output_tokens:
          acc.reasoning_output_tokens + r.reasoning_output_tokens,
        total_tokens: acc.total_tokens + r.total_tokens,
      }),
      {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
      },
    );

    // Query earliest usage record (unfiltered by date range)
    let firstSeen: string | null = null;
    try {
      firstSeen = await db.getUserFirstSeen(user.id);
    } catch {
      // Non-critical — graceful fallthrough
    }

    // Fetch active badges for this user
    let badges: { text: string; icon: string; colorBg: string; colorText: string }[] = [];
    try {
      const activeBadges = await db.getActiveBadgesForUser(user.id);
      badges = activeBadges.map((b) => ({
        text: b.text,
        icon: b.icon,
        colorBg: b.color_bg,
        colorText: b.color_text,
      }));
    } catch {
      // Non-critical — graceful fallthrough
    }

    return NextResponse.json({
      user: {
        name: user.name,
        image: user.image,
        slug: user.slug,
        created_at: user.created_at,
        first_seen: firstSeen,
        badges,
      },
      records,
      summary,
    });
  } catch (err) {
    console.error("Failed to query public profile:", err);
    return NextResponse.json(
      { error: "Failed to load profile data" },
      { status: 500 },
    );
  }
}

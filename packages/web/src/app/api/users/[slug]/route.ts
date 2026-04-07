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
import { getDbRead } from "@/lib/db";
import { resolveUser } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/admin";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "openclaw",
  "pi",
  "vscode-copilot",
  "copilot-cli",
]);

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  name: string | null;
  image: string | null;
  slug: string;
  is_public: number | null;
  created_at: string;
}

interface UsageRow {
  source: string;
  model: string;
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

// ---------------------------------------------------------------------------
// Authorization: bypass is_public
// ---------------------------------------------------------------------------

interface DbReadLike {
  firstOrNull<T>(sql: string, params: unknown[]): Promise<T | null>;
}

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
  db: DbReadLike,
  targetUserId: string,
): Promise<boolean> {
  const auth = await resolveUser(request);
  if (!auth) return false;

  // 1. Admin bypass
  if (isAdmin(auth.email)) return true;

  // 2. Teammate check — caller and target share at least one team
  try {
    const teammate = await db.firstOrNull<{ team_id: string }>(
      `SELECT a.team_id
       FROM team_members a
       JOIN team_members b ON a.team_id = b.team_id
       WHERE a.user_id = ? AND b.user_id = ?
       LIMIT 1`,
      [auth.userId, targetUserId],
    );
    if (teammate) return true;
  } catch {
    // team_members table may not exist — graceful fallthrough
  }

  // 3. Same-season check — both users belong to teams registered in the same season
  try {
    const sameSeason = await db.firstOrNull<{ season_id: string }>(
      `SELECT st1.season_id
       FROM season_teams st1
       JOIN team_members tm1 ON st1.team_id = tm1.team_id
       JOIN season_teams st2 ON st1.season_id = st2.season_id
       JOIN team_members tm2 ON st2.team_id = tm2.team_id
       WHERE tm1.user_id = ? AND tm2.user_id = ?
       LIMIT 1`,
      [auth.userId, targetUserId],
    );
    if (sameSeason) return true;
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

  // 2. Look up user by slug, falling back to id lookup (for admin access to users without slugs)
  let user: UserRow | null;
  let hasIsPublicColumn = true;

  try {
    user = await db.firstOrNull<UserRow>(
      "SELECT id, name, image, slug, created_at, is_public FROM users WHERE slug = ?",
      [slug],
    );
    // Fallback: try by user id if slug lookup returned nothing
    if (!user) {
      user = await db.firstOrNull<UserRow>(
        "SELECT id, name, image, slug, created_at, is_public FROM users WHERE id = ?",
        [slug],
      );
    }
  } catch (err: unknown) {
    // Fallback: is_public column doesn't exist yet (pre-migration)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such column")) {
      hasIsPublicColumn = false;
      user = await db.firstOrNull<UserRow>(
        "SELECT id, name, image, slug, created_at FROM users WHERE slug = ?",
        [slug],
      );
      if (!user) {
        user = await db.firstOrNull<UserRow>(
          "SELECT id, name, image, slug, created_at FROM users WHERE id = ?",
          [slug],
        );
      }
    } else {
      throw err;
    }
  }

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Return 404 if user is not public — unless caller has access
  if (hasIsPublicColumn && !user.is_public) {
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
  let toDate: Date | null = null;

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
  }

  if (sourceFilter && !VALID_SOURCES.has(sourceFilter)) {
    return NextResponse.json(
      { error: `Invalid source: "${sourceFilter}"` },
      { status: 400 },
    );
  }

  // 4. Build query
  const conditions = ["user_id = ?", "hour_start >= ?"];
  const queryParams: unknown[] = [user.id, fromDate.toISOString()];

  if (toDate) {
    conditions.push("hour_start < ?");
    queryParams.push(toDate.toISOString());
  }

  if (sourceFilter) {
    conditions.push("source = ?");
    queryParams.push(sourceFilter);
  }

  const sql = `
    SELECT
      source,
      model,
      date(hour_start) AS hour_start,
      SUM(input_tokens) AS input_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(reasoning_output_tokens) AS reasoning_output_tokens,
      SUM(total_tokens) AS total_tokens
    FROM usage_records
    WHERE ${conditions.join(" AND ")}
    GROUP BY date(hour_start), source, model
    ORDER BY hour_start ASC, source, model
  `;

  try {
    const result = await db.query<UsageRow>(sql, queryParams);
    const records = result.results;

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
      const earliest = await db.firstOrNull<{ first_seen: string }>(
        "SELECT MIN(hour_start) AS first_seen FROM usage_records WHERE user_id = ?",
        [user.id],
      );
      firstSeen = earliest?.first_seen ?? null;
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

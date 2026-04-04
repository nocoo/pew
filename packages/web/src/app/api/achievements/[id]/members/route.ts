/**
 * GET /api/achievements/[id]/members — paginated list of users who earned a specific achievement.
 *
 * Query params:
 *   limit  — max entries to return (default: 50, max: 100)
 *   cursor — pagination cursor from previous response
 *
 * Returns { members[], cursor } with user info and achievement tier.
 *
 * Error responses:
 *   404 — Achievement ID not found
 *   404 — Achievement is timezone-dependent (no social features)
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { getDefaultPricingMap } from "@/lib/pricing";
import {
  getAchievementDef,
  computeTierProgress,
  TIMEZONE_DEPENDANT_IDS,
  type AchievementTier,
} from "@/lib/achievement-helpers";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemberRow {
  id: string;
  name: string | null;
  image: string | null;
  slug: string | null;
  value: number;
  first_activity: string | null;
}

interface MemberResponse {
  id: string;
  name: string;
  image: string | null;
  slug: string | null;
  tier: Exclude<AchievementTier, "locked">;
  earnedAt: string;
  currentValue: number;
}

// ---------------------------------------------------------------------------
// Achievement-specific SQL queries
// ---------------------------------------------------------------------------

type QueryBuilder = (
  bronzeThreshold: number,
  limit: number,
  offset: number,
) => {
  sql: string;
  params: (string | number)[];
};

/**
 * Build SQL query for a specific achievement type.
 * Returns members who have reached at least bronze tier, ordered by value desc.
 */
function getQueryBuilder(achievementId: string): QueryBuilder | null {
  switch (achievementId) {
    // Volume achievements — aggregate from usage_records
    case "power-user":
    case "first-blood":
    case "millionaire":
    case "billionaire":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COALESCE(SUM(ur.total_tokens), 0) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "input-hog":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COALESCE(SUM(ur.input_tokens), 0) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "output-addict":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COALESCE(SUM(ur.output_tokens), 0) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "reasoning-junkie":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COALESCE(SUM(ur.reasoning_output_tokens), 0) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    // Consistency — day counts (UTC)
    case "veteran":
    case "centurion":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COUNT(DISTINCT DATE(ur.hour_start)) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    // Big day — max tokens in a single day
    case "big-day":
      return (threshold, limit, offset) => ({
        sql: `
          WITH daily AS (
            SELECT user_id, DATE(hour_start) AS day, SUM(total_tokens) AS day_tokens
            FROM usage_records
            GROUP BY user_id, DATE(hour_start)
          ),
          user_max AS (
            SELECT user_id, MAX(day_tokens) AS value
            FROM daily
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, um.value,
                 (SELECT MIN(hour_start) FROM usage_records WHERE user_id = u.id) AS first_activity
          FROM users u
          JOIN user_max um ON um.user_id = u.id
          WHERE u.is_public = 1 AND um.value >= ?
          ORDER BY um.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    // Efficiency — cache rate
    case "cache-master":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 CASE WHEN SUM(ur.input_tokens) > 0
                      THEN (SUM(ur.cached_input_tokens) * 100.0 / SUM(ur.input_tokens))
                      ELSE 0 END AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    // Diversity — count distinct values
    case "tool-hoarder":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COUNT(DISTINCT ur.source) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "model-tourist":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COUNT(DISTINCT ur.model) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "device-nomad":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COUNT(DISTINCT ur.device_id) AS value,
                 MIN(ur.hour_start) AS first_activity
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    // Session-based achievements
    case "quick-draw":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 SUM(CASE WHEN sr.duration_seconds < 300 THEN 1 ELSE 0 END) AS value,
                 MIN(sr.session_start) AS first_activity
          FROM users u
          JOIN session_records sr ON sr.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "marathon":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 SUM(CASE WHEN sr.duration_seconds > 7200 THEN 1 ELSE 0 END) AS value,
                 MIN(sr.session_start) AS first_activity
          FROM users u
          JOIN session_records sr ON sr.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "chatterbox":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_max AS (
            SELECT user_id, MAX(total_messages) AS value
            FROM session_records
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, um.value,
                 (SELECT MIN(session_start) FROM session_records WHERE user_id = u.id) AS first_activity
          FROM users u
          JOIN user_max um ON um.user_id = u.id
          WHERE u.is_public = 1 AND um.value >= ?
          ORDER BY um.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "session-hoarder":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 COUNT(*) AS value,
                 MIN(sr.session_start) AS first_activity
          FROM users u
          JOIN session_records sr ON sr.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    case "automation-addict":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 SUM(CASE WHEN sr.kind = 'automated' THEN 1 ELSE 0 END) AS value,
                 MIN(sr.session_start) AS first_activity
          FROM users u
          JOIN session_records sr ON sr.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING value >= ?
          ORDER BY value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, limit, offset],
      });

    // Spending achievements — need cost calculation
    // These are more complex because cost requires pricing lookup per model
    // For now, return null and exclude from members endpoint
    case "big-spender":
    case "daily-burn":
      return null;

    // Streak achievement — would need real-time calculation
    // Excluding from members for now as it's complex
    case "streak":
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);

  // Validate achievement exists
  const def = getAchievementDef(id);
  if (!def) {
    return NextResponse.json(
      { error: `Achievement not found: ${id}` },
      { status: 404 },
    );
  }

  // Timezone-dependent achievements have no social features
  if (TIMEZONE_DEPENDANT_IDS.has(id)) {
    return NextResponse.json(
      { error: `Achievement "${id}" is timezone-dependent and has no social features` },
      { status: 404 },
    );
  }

  // Parse query params
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor");

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

  let offset = 0;
  if (cursorParam) {
    const parsed = parseInt(cursorParam, 10);
    if (isNaN(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "Invalid cursor" },
        { status: 400 },
      );
    }
    offset = parsed;
  }

  // Get query builder for this achievement
  getDefaultPricingMap(); // Ensure pricing is available (unused for now but may be needed for spending achievements)
  const queryBuilder = getQueryBuilder(id);

  if (!queryBuilder) {
    // Achievement exists but members query not implemented
    // Return empty list instead of error (graceful degradation)
    return NextResponse.json({
      members: [],
      cursor: null,
    });
  }

  const db = await getDbRead();
  const bronzeThreshold = def.tiers[0];

  try {
    const { sql, params: queryParams } = queryBuilder(bronzeThreshold, limit + 1, offset);
    const result = await db.query<MemberRow>(sql, queryParams);

    // Check if there are more results
    const hasMore = result.results.length > limit;
    const rows = hasMore ? result.results.slice(0, limit) : result.results;

    const members: MemberResponse[] = rows.map((row) => {
      const { tier } = computeTierProgress(row.value, def.tiers);
      return {
        id: row.id,
        name: row.name ?? "Anonymous",
        image: row.image,
        slug: row.slug,
        tier: tier === "locked" ? "bronze" : tier,
        earnedAt: row.first_activity ?? new Date().toISOString(),
        currentValue: row.value,
      };
    });

    return NextResponse.json({
      members,
      cursor: hasMore ? String(offset + limit) : null,
    });
  } catch (err) {
    console.error(`Failed to fetch members for achievement ${id}:`, err);
    return NextResponse.json(
      { error: "Failed to fetch achievement members" },
      { status: 500 },
    );
  }
}

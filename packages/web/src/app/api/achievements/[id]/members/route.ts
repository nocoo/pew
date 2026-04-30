/**
 * GET /api/achievements/[id]/members — paginated list of users who earned a specific achievement.
 *
 * Query params:
 *   limit  — max entries to return (default: 50, max: 100)
 *   cursor — pagination cursor from previous response
 *
 * Returns { members[], cursor } with user info and achievement tier.
 *
 * The `earnedAt` field is an approximation of when the user first reached the bronze threshold.
 * For aggregation-based achievements, we use cumulative sums with window functions to find
 * the earliest date where the running total crossed the threshold. For some achievements
 * (spending, cache-rate), earnedAt is unavailable and returns the current timestamp.
 *
 * Error responses:
 *   404 — Achievement ID not found
 *   404 — Achievement is timezone-dependent (no social features)
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
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
 *
 * The `earned_at` field uses cumulative sums with window functions to find
 * the earliest date/hour where the user's running total crossed the threshold.
 * For achievements where this is impractical (spending, max-based), earned_at is NULL.
 */
function getQueryBuilder(achievementId: string): QueryBuilder | null {
  switch (achievementId) {
    // Volume achievements — cumulative sum to find when threshold was crossed
    case "power-user":
    case "first-blood":
    case "millionaire":
    case "billionaire":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, SUM(total_tokens) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          cumulative AS (
            SELECT user_id, hour_start,
                   SUM(total_tokens) OVER (PARTITION BY user_id ORDER BY hour_start) AS running_total
            FROM usage_records
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(hour_start) AS earned_at
            FROM cumulative
            WHERE running_total >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "input-hog":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, SUM(input_tokens) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          cumulative AS (
            SELECT user_id, hour_start,
                   SUM(input_tokens) OVER (PARTITION BY user_id ORDER BY hour_start) AS running_total
            FROM usage_records
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(hour_start) AS earned_at
            FROM cumulative
            WHERE running_total >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "output-addict":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, SUM(output_tokens) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          cumulative AS (
            SELECT user_id, hour_start,
                   SUM(output_tokens) OVER (PARTITION BY user_id ORDER BY hour_start) AS running_total
            FROM usage_records
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(hour_start) AS earned_at
            FROM cumulative
            WHERE running_total >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "reasoning-junkie":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, SUM(reasoning_output_tokens) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          cumulative AS (
            SELECT user_id, hour_start,
                   SUM(reasoning_output_tokens) OVER (PARTITION BY user_id ORDER BY hour_start) AS running_total
            FROM usage_records
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(hour_start) AS earned_at
            FROM cumulative
            WHERE running_total >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    // Consistency — day counts with cumulative day tracking
    case "veteran":
    case "centurion":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, COUNT(DISTINCT DATE(hour_start)) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          daily AS (
            SELECT user_id, DATE(hour_start) AS day, MIN(hour_start) AS first_hour
            FROM usage_records
            GROUP BY user_id, DATE(hour_start)
          ),
          numbered AS (
            SELECT user_id, day, first_hour,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day) AS day_num
            FROM daily
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(first_hour) AS earned_at
            FROM numbered
            WHERE day_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    // Big day — max tokens in a single day (earned_at = first day that hit the max)
    case "big-day":
      return (threshold, limit, offset) => ({
        sql: `
          WITH daily AS (
            SELECT user_id, DATE(hour_start) AS day, SUM(total_tokens) AS day_tokens,
                   MIN(hour_start) AS first_hour
            FROM usage_records
            GROUP BY user_id, DATE(hour_start)
          ),
          user_max AS (
            SELECT user_id, MAX(day_tokens) AS value
            FROM daily
            GROUP BY user_id
          ),
          first_big_day AS (
            SELECT d.user_id, MIN(d.first_hour) AS earned_at
            FROM daily d
            JOIN user_max um ON d.user_id = um.user_id AND d.day_tokens >= ?
            GROUP BY d.user_id
          )
          SELECT u.id, u.name, u.image, u.slug, um.value, fbd.earned_at
          FROM users u
          JOIN user_max um ON um.user_id = u.id
          LEFT JOIN first_big_day fbd ON fbd.user_id = u.id
          WHERE u.is_public = 1 AND um.value >= ?
          ORDER BY um.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    // Efficiency — cache rate (earned_at not easily calculable, use NULL)
    case "cache-master":
      return (threshold, limit, offset) => ({
        sql: `
          SELECT u.id, u.name, u.image, u.slug,
                 CASE WHEN SUM(ur.input_tokens) > 0
                      THEN (SUM(ur.cached_input_tokens) * 100.0 / SUM(ur.input_tokens))
                      ELSE 0 END AS value,
                 NULL AS earned_at
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

    // Diversity — cumulative distinct count tracking
    case "tool-hoarder":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, COUNT(DISTINCT source) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          first_source AS (
            SELECT user_id, source, MIN(hour_start) AS first_hour
            FROM usage_records
            GROUP BY user_id, source
          ),
          numbered AS (
            SELECT user_id, source, first_hour,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY first_hour) AS source_num
            FROM first_source
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(first_hour) AS earned_at
            FROM numbered
            WHERE source_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "model-tourist":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, COUNT(DISTINCT model) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          first_model AS (
            SELECT user_id, model, MIN(hour_start) AS first_hour
            FROM usage_records
            GROUP BY user_id, model
          ),
          numbered AS (
            SELECT user_id, model, first_hour,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY first_hour) AS model_num
            FROM first_model
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(first_hour) AS earned_at
            FROM numbered
            WHERE model_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "device-nomad":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, COUNT(DISTINCT device_id) AS value
            FROM usage_records
            GROUP BY user_id
          ),
          first_device AS (
            SELECT user_id, device_id, MIN(hour_start) AS first_hour
            FROM usage_records
            GROUP BY user_id, device_id
          ),
          numbered AS (
            SELECT user_id, device_id, first_hour,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY first_hour) AS device_num
            FROM first_device
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(first_hour) AS earned_at
            FROM numbered
            WHERE device_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    // Session-based achievements — cumulative session count tracking
    case "quick-draw":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, SUM(CASE WHEN duration_seconds < 300 THEN 1 ELSE 0 END) AS value
            FROM session_records
            GROUP BY user_id
          ),
          quick_sessions AS (
            SELECT user_id, started_at,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY started_at) AS session_num
            FROM session_records
            WHERE duration_seconds < 300
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(started_at) AS earned_at
            FROM quick_sessions
            WHERE session_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "marathon":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, SUM(CASE WHEN duration_seconds > 7200 THEN 1 ELSE 0 END) AS value
            FROM session_records
            GROUP BY user_id
          ),
          marathon_sessions AS (
            SELECT user_id, started_at,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY started_at) AS session_num
            FROM session_records
            WHERE duration_seconds > 7200
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(started_at) AS earned_at
            FROM marathon_sessions
            WHERE session_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "chatterbox":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_max AS (
            SELECT user_id, MAX(total_messages) AS value
            FROM session_records
            GROUP BY user_id
          ),
          first_chatty AS (
            SELECT sr.user_id, MIN(sr.started_at) AS earned_at
            FROM session_records sr
            JOIN user_max um ON sr.user_id = um.user_id
            WHERE sr.total_messages >= ?
            GROUP BY sr.user_id
          )
          SELECT u.id, u.name, u.image, u.slug, um.value, fc.earned_at
          FROM users u
          JOIN user_max um ON um.user_id = u.id
          LEFT JOIN first_chatty fc ON fc.user_id = u.id
          WHERE u.is_public = 1 AND um.value >= ?
          ORDER BY um.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "session-hoarder":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, COUNT(*) AS value
            FROM session_records
            GROUP BY user_id
          ),
          numbered AS (
            SELECT user_id, started_at,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY started_at) AS session_num
            FROM session_records
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(started_at) AS earned_at
            FROM numbered
            WHERE session_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    case "automation-addict":
      return (threshold, limit, offset) => ({
        sql: `
          WITH user_totals AS (
            SELECT user_id, SUM(CASE WHEN kind = 'automated' THEN 1 ELSE 0 END) AS value
            FROM session_records
            GROUP BY user_id
          ),
          auto_sessions AS (
            SELECT user_id, started_at,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY started_at) AS session_num
            FROM session_records
            WHERE kind = 'automated'
          ),
          threshold_crossed AS (
            SELECT user_id, MIN(started_at) AS earned_at
            FROM auto_sessions
            WHERE session_num >= ?
            GROUP BY user_id
          )
          SELECT u.id, u.name, u.image, u.slug, ut.value, tc.earned_at
          FROM users u
          JOIN user_totals ut ON ut.user_id = u.id
          LEFT JOIN threshold_crossed tc ON tc.user_id = u.id
          WHERE u.is_public = 1 AND ut.value >= ?
          ORDER BY ut.value DESC
          LIMIT ? OFFSET ?
        `,
        params: [threshold, threshold, limit, offset],
      });

    // Spending achievements — cost requires runtime pricing lookup, not supported in SQL
    // Return null to gracefully degrade (empty members list)
    case "big-spender":
    case "daily-burn":
      return null;

    // Streak achievement — requires date continuity analysis, complex in SQL
    // Return null to gracefully degrade (empty members list)
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
      { error: "Achievement not found" },
      { status: 404 },
    );
  }

  // Timezone-dependent achievements have no social features
  if (TIMEZONE_DEPENDANT_IDS.has(id)) {
    return NextResponse.json(
      { error: "Achievement is timezone-dependent and has no social features" },
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
    const rows = await db.getAchievementEarners(id, sql, queryParams);

    // Check if there are more results
    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const members: MemberResponse[] = resultRows.map((row) => {
      const { tier } = computeTierProgress(row.value, def.tiers);
      return {
        id: row.id,
        name: row.name ?? "Anonymous",
        image: row.image,
        slug: row.slug,
        tier: tier === "locked" ? "bronze" : tier,
        earnedAt: row.earned_at ?? new Date().toISOString(),
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

/**
 * GET /api/achievements — compute achievement progress for authenticated user.
 *
 * Query params:
 *   tzOffset — timezone offset in minutes (optional, default: 0/UTC)
 *              Only affects timezone-dependent achievements (weekend-warrior, night-owl, early-bird)
 *
 * Returns { achievements[], summary } per API Design in doc/33.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead } from "@/lib/db";
import { getDefaultPricingMap, lookupPricing, type PricingMap } from "@/lib/pricing";
import {
  ACHIEVEMENT_DEFS,
  TIMEZONE_DEPENDANT_IDS,
  computeTierProgress,
  type AchievementTier,
  type AchievementCategory,
} from "@/lib/achievement-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UsageAggregates {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
}

interface DailyUsageRow {
  day: string;
  total_tokens: number;
}

interface DiversityRow {
  source_count: number;
  model_count: number;
  device_count: number;
}

interface SessionAggregates {
  total_sessions: number;
  quick_sessions: number; // duration < 5 min
  marathon_sessions: number; // duration > 2 hours
  max_messages: number;
  automated_sessions: number;
}

interface HourlyUsageRow {
  hour_start: string;
  total_tokens: number;
}

interface EarnedByUser {
  id: string;
  name: string;
  image: string | null;
  slug: string | null;
  tier: AchievementTier;
}

interface AchievementResponse {
  id: string;
  name: string;
  flavorText: string;
  icon: string;
  category: AchievementCategory;
  tier: AchievementTier;
  currentValue: number;
  tiers: readonly [number, number, number, number];
  progress: number;
  displayValue: string;
  displayThreshold: string;
  unit: string;
  earnedBy: EarnedByUser[];
  totalEarned: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  pricingMap: PricingMap
): number {
  const pricing = lookupPricing(pricingMap, model);

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cachedCost = cachedTokens && pricing.cached
    ? (cachedTokens / 1_000_000) * pricing.cached
    : 0;

  return inputCost + outputCost + cachedCost;
}

/**
 * Compute the number of consecutive active days ending at today (UTC).
 */
function computeStreak(activeDays: Set<string>, today: string): number {
  if (activeDays.size === 0) return 0;

  let streak = 0;
  const current = new Date(today);

  while (true) {
    const dateStr = current.toISOString().slice(0, 10);
    if (activeDays.has(dateStr)) {
      streak++;
      current.setUTCDate(current.getUTCDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Check if a UTC hour_start falls within local weekend (Saturday or Sunday).
 */
function isLocalWeekend(hourStart: string, tzOffset: number): boolean {
  const utcDate = new Date(hourStart);
  const localDate = new Date(utcDate.getTime() - tzOffset * 60 * 1000);
  const dayOfWeek = localDate.getUTCDay(); // 0=Sun, 6=Sat
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Check if a UTC hour_start falls within local night-owl hours (midnight-6am).
 */
function isLocalNightOwl(hourStart: string, tzOffset: number): boolean {
  const utcHour = new Date(hourStart).getUTCHours();
  const localHour = (utcHour - tzOffset / 60 + 24) % 24;
  return localHour >= 0 && localHour < 6;
}

/**
 * Check if a UTC hour_start falls within local early-bird hours (6am-9am).
 */
function isLocalEarlyBird(hourStart: string, tzOffset: number): boolean {
  const utcHour = new Date(hourStart).getUTCHours();
  const localHour = (utcHour - tzOffset / 60 + 24) % 24;
  return localHour >= 6 && localHour < 9;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // 1. Authenticate
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;

  // 2. Parse query params
  const url = new URL(request.url);
  const tzOffsetParam = url.searchParams.get("tzOffset");
  const tzOffset = tzOffsetParam ? parseInt(tzOffsetParam, 10) : 0;

  // 3. Query data
  const db = await getDbRead();
  const pricingMap = getDefaultPricingMap();
  const today = new Date().toISOString().slice(0, 10);

  try {
    // ---- Usage aggregates ----
    const usageAgg = await db.firstOrNull<UsageAggregates>(
      `SELECT
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS reasoning_output_tokens
      FROM usage_records
      WHERE user_id = ?`,
      [userId]
    );

    // ---- Daily usage (for streak, big-day, veteran) ----
    const dailyUsage = await db.query<DailyUsageRow>(
      `SELECT DATE(hour_start) AS day, SUM(total_tokens) AS total_tokens
      FROM usage_records
      WHERE user_id = ?
      GROUP BY DATE(hour_start)
      ORDER BY day`,
      [userId]
    );

    // ---- Daily cost (for daily-burn) ----
    const costByModelDay = await db.query<{
      day: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens: number;
    }>(
      `SELECT DATE(hour_start) AS day, model,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens
      FROM usage_records
      WHERE user_id = ?
      GROUP BY DATE(hour_start), model`,
      [userId]
    );

    // Aggregate cost by day
    const dailyCostMap = new Map<string, number>();
    for (const row of costByModelDay.results) {
      const cost = computeCost(
        row.model,
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        pricingMap
      );
      dailyCostMap.set(row.day, (dailyCostMap.get(row.day) ?? 0) + cost);
    }

    // ---- Diversity counts ----
    const diversity = await db.firstOrNull<DiversityRow>(
      `SELECT
        COUNT(DISTINCT source) AS source_count,
        COUNT(DISTINCT model) AS model_count,
        COUNT(DISTINCT device_id) AS device_count
      FROM usage_records
      WHERE user_id = ?`,
      [userId]
    );

    // ---- Session aggregates ----
    const sessionAgg = await db.firstOrNull<SessionAggregates>(
      `SELECT
        COUNT(*) AS total_sessions,
        SUM(CASE WHEN duration_seconds < 300 THEN 1 ELSE 0 END) AS quick_sessions,
        SUM(CASE WHEN duration_seconds > 7200 THEN 1 ELSE 0 END) AS marathon_sessions,
        MAX(total_messages) AS max_messages,
        SUM(CASE WHEN kind = 'automated' THEN 1 ELSE 0 END) AS automated_sessions
      FROM session_records
      WHERE user_id = ?`,
      [userId]
    );

    // ---- Hourly usage for timezone-dependent achievements ----
    const hourlyUsage = await db.query<HourlyUsageRow>(
      `SELECT hour_start, SUM(total_tokens) AS total_tokens
      FROM usage_records
      WHERE user_id = ?
      GROUP BY hour_start`,
      [userId]
    );

    // ---- Total cost by model (for big-spender) ----
    const costByModel = await db.query<{
      model: string;
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens: number;
    }>(
      `SELECT model,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens
      FROM usage_records
      WHERE user_id = ?
      GROUP BY model`,
      [userId]
    );

    let totalCost = 0;
    for (const row of costByModel.results) {
      totalCost += computeCost(
        row.model,
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        pricingMap
      );
    }

    // 4. Compute achievement values
    const activeDays = new Set(dailyUsage.results.map((r) => r.day));
    const streak = computeStreak(activeDays, today);
    const biggestDay = dailyUsage.results.reduce(
      (max, r) => Math.max(max, r.total_tokens),
      0
    );
    const biggestDailyCost = Math.max(...dailyCostMap.values(), 0);

    // Timezone-dependent values
    let weekendDays = 0;
    let nightOwlHours = 0;
    let earlyBirdHours = 0;
    const seenWeekendDays = new Set<string>();
    const seenNightOwlHours = new Set<string>();
    const seenEarlyBirdHours = new Set<string>();

    for (const row of hourlyUsage.results) {
      if (row.total_tokens > 0) {
        // Weekend warrior: count unique local weekend days
        if (isLocalWeekend(row.hour_start, tzOffset)) {
          const localDate = new Date(
            new Date(row.hour_start).getTime() - tzOffset * 60 * 1000
          );
          const dayKey = localDate.toISOString().slice(0, 10);
          if (!seenWeekendDays.has(dayKey)) {
            seenWeekendDays.add(dayKey);
            weekendDays++;
          }
        }

        // Night owl: count unique local hours
        if (isLocalNightOwl(row.hour_start, tzOffset)) {
          const hourKey = row.hour_start.slice(0, 13);
          if (!seenNightOwlHours.has(hourKey)) {
            seenNightOwlHours.add(hourKey);
            nightOwlHours++;
          }
        }

        // Early bird: count unique local hours
        if (isLocalEarlyBird(row.hour_start, tzOffset)) {
          const hourKey = row.hour_start.slice(0, 13);
          if (!seenEarlyBirdHours.has(hourKey)) {
            seenEarlyBirdHours.add(hourKey);
            earlyBirdHours++;
          }
        }
      }
    }

    // Build achievement values map
    const values: Record<string, number> = {
      // Volume
      "power-user": usageAgg?.total_tokens ?? 0,
      "big-day": biggestDay,
      "input-hog": usageAgg?.input_tokens ?? 0,
      "output-addict": usageAgg?.output_tokens ?? 0,
      "reasoning-junkie": usageAgg?.reasoning_output_tokens ?? 0,

      // Consistency
      streak,
      veteran: activeDays.size,
      "weekend-warrior": weekendDays,
      "night-owl": nightOwlHours,
      "early-bird": earlyBirdHours,

      // Efficiency
      "cache-master":
        (usageAgg?.input_tokens ?? 0) > 0
          ? ((usageAgg?.cached_input_tokens ?? 0) /
              (usageAgg?.input_tokens ?? 1)) *
            100
          : 0,
      "quick-draw": sessionAgg?.quick_sessions ?? 0,
      marathon: sessionAgg?.marathon_sessions ?? 0,

      // Spending
      "big-spender": totalCost,
      "daily-burn": biggestDailyCost,

      // Diversity
      "tool-hoarder": diversity?.source_count ?? 0,
      "model-tourist": diversity?.model_count ?? 0,
      "device-nomad": diversity?.device_count ?? 0,

      // Sessions
      chatterbox: sessionAgg?.max_messages ?? 0,
      "session-hoarder": sessionAgg?.total_sessions ?? 0,
      "automation-addict": sessionAgg?.automated_sessions ?? 0,

      // Special
      "first-blood": usageAgg?.total_tokens ?? 0,
      centurion: activeDays.size,
      millionaire: usageAgg?.total_tokens ?? 0,
      billionaire: usageAgg?.total_tokens ?? 0,
    };

    // 5. Query earnedBy data for non-timezone-dependent achievements
    const earnedByMap = new Map<string, EarnedByUser[]>();
    const totalEarnedMap = new Map<string, number>();

    // For each non-timezone-dependent achievement, query top 5 earners
    const socialAchievements = ACHIEVEMENT_DEFS.filter(
      (d) => !TIMEZONE_DEPENDANT_IDS.has(d.id)
    );

    for (const def of socialAchievements) {
      // Skip querying if we don't have a simple threshold-based query
      // For now, only implement earnedBy for power-user (total_tokens)
      // TODO: Implement earnedBy for other achievements in Phase 2
      if (def.id === "power-user") {
        const bronzeThreshold = def.tiers[0];
        const earners = await db.query<{
          id: string;
          name: string | null;
          image: string | null;
          slug: string | null;
          total_tokens: number;
        }>(
          `SELECT u.id, u.name, u.image, u.slug, COALESCE(SUM(ur.total_tokens), 0) AS total_tokens
          FROM users u
          JOIN usage_records ur ON ur.user_id = u.id
          WHERE u.is_public = 1
          GROUP BY u.id
          HAVING total_tokens >= ?
          ORDER BY total_tokens DESC
          LIMIT 5`,
          [bronzeThreshold]
        );

        const users: EarnedByUser[] = earners.results.map((r) => {
          const { tier } = computeTierProgress(r.total_tokens, def.tiers);
          return {
            id: r.id,
            name: r.name ?? "Anonymous",
            image: r.image,
            slug: r.slug,
            tier: tier === "locked" ? "bronze" : tier,
          };
        });

        earnedByMap.set(def.id, users);

        // Count total earners
        const countResult = await db.firstOrNull<{ count: number }>(
          `SELECT COUNT(*) AS count FROM (
            SELECT u.id
            FROM users u
            JOIN usage_records ur ON ur.user_id = u.id
            WHERE u.is_public = 1
            GROUP BY u.id
            HAVING COALESCE(SUM(ur.total_tokens), 0) >= ?
          )`,
          [bronzeThreshold]
        );
        totalEarnedMap.set(def.id, countResult?.count ?? 0);
      }
    }

    // 6. Build response
    const achievements: AchievementResponse[] = ACHIEVEMENT_DEFS.map((def) => {
      const currentValue = values[def.id] ?? 0;
      const { tier, progress, nextThreshold } = computeTierProgress(
        currentValue,
        def.tiers
      );

      const isTimezoneDep = TIMEZONE_DEPENDANT_IDS.has(def.id);

      return {
        id: def.id,
        name: def.name,
        flavorText: def.flavorText,
        icon: def.icon,
        category: def.category,
        tier,
        currentValue,
        tiers: def.tiers,
        progress,
        displayValue: def.format(currentValue),
        displayThreshold: def.format(nextThreshold),
        unit: def.unit,
        earnedBy: isTimezoneDep ? [] : earnedByMap.get(def.id) ?? [],
        totalEarned: isTimezoneDep ? 0 : totalEarnedMap.get(def.id) ?? 0,
      };
    });

    // Compute summary
    const totalUnlocked = achievements.filter((a) => a.tier !== "locked").length;
    const diamondCount = achievements.filter((a) => a.tier === "diamond").length;

    return NextResponse.json({
      achievements,
      summary: {
        totalUnlocked,
        totalAchievements: ACHIEVEMENT_DEFS.length,
        diamondCount,
        currentStreak: streak,
      },
    });
  } catch (err) {
    console.error("Failed to compute achievements:", err);
    return NextResponse.json(
      { error: "Failed to compute achievements" },
      { status: 500 }
    );
  }
}

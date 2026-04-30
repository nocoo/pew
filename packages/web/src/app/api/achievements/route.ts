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
import { lookupPricing, type PricingMap } from "@/lib/pricing";
import { loadPricingMap } from "@/lib/load-pricing-map";
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
  source: string | null,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  pricingMap: PricingMap
): number {
  const pricing = lookupPricing(pricingMap, model, source ?? undefined);

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
 * Compute the longest streak of consecutive active days.
 */
function computeLongestStreak(activeDays: Set<string>): number {
  if (activeDays.size === 0) return 0;

  const sortedDays = Array.from(activeDays).sort();
  let longest = 1;
  let current = 1;

  for (let i = 1; i < sortedDays.length; i++) {
    const prevDay = sortedDays[i - 1];
    const currDay = sortedDays[i];
    if (!prevDay || !currDay) continue;

    const prevDate = new Date(prevDay);
    const currDate = new Date(currDay);
    const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
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
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : null; // null = full mode (all achievements + earnedBy)

  // 3. Query data (parallel fetch for performance)
  const db = await getDbRead();
  const pricingMap = await loadPricingMap(db);
  const today = new Date().toISOString().slice(0, 10);

  try {
    // ---- Parallel fetch all base data ----
    const [
      usageAgg,
      dailyUsage,
      costByModelSourceDay,
      diversity,
      sessionAgg,
      hourlyUsage,
      costByModelSource,
    ] = await Promise.all([
      db.getAchievementUsageAggregates(userId),
      db.getAchievementDailyUsage(userId),
      db.getAchievementDailyCostBreakdown(userId),
      db.getAchievementDiversityCounts(userId),
      db.getAchievementSessionAggregates(userId),
      db.getAchievementHourlyUsage(userId),
      db.getAchievementCostByModelSource(userId),
    ]);

    // Aggregate cost by day
    const dailyCostMap = new Map<string, number>();
    for (const row of costByModelSourceDay) {
      const cost = computeCost(
        row.model,
        row.source,
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        pricingMap
      );
      dailyCostMap.set(row.day, (dailyCostMap.get(row.day) ?? 0) + cost);
    }

    let totalCost = 0;
    for (const row of costByModelSource) {
      totalCost += computeCost(
        row.model,
        row.source,
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        pricingMap
      );
    }

    // 4. Compute achievement values
    const activeDays = new Set(dailyUsage.map((r) => r.day));
    const streak = computeStreak(activeDays, today);
    const biggestDay = dailyUsage.reduce(
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

    for (const row of hourlyUsage) {
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

    // 5. Query earnedBy data for non-timezone-dependent achievements (skip in limit mode)
    const earnedByMap = new Map<string, EarnedByUser[]>();
    const totalEarnedMap = new Map<string, number>();

    if (limit === null) {
      // For each non-timezone-dependent achievement, query top 5 earners
      const socialAchievements = ACHIEVEMENT_DEFS.filter(
        (d) => !TIMEZONE_DEPENDANT_IDS.has(d.id)
      );

      // Helper to run earnedBy query for an achievement
      async function queryEarnedBy(
        def: typeof ACHIEVEMENT_DEFS[number],
        sql: string,
        countSql: string,
        threshold: number
      ) {
        const earners = await db.getAchievementEarners(def.id, sql, [threshold, 5, 0]);

        const users: EarnedByUser[] = earners.map((r) => {
          const { tier } = computeTierProgress(r.value, def.tiers);
          return {
            id: r.id,
            name: r.name ?? "Anonymous",
            image: r.image,
            slug: r.slug,
            tier: tier === "locked" ? "bronze" : tier,
          };
        });

      earnedByMap.set(def.id, users);

      const count = await db.getAchievementEarnersCount(def.id, countSql, [threshold]);
      totalEarnedMap.set(def.id, count);
    }

    for (const def of socialAchievements) {
      const bronzeThreshold = def.tiers[0];

      // Volume achievements (total_tokens based)
      if (["power-user", "first-blood", "millionaire", "billionaire"].includes(def.id)) {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COALESCE(SUM(ur.total_tokens), 0) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COALESCE(SUM(ur.total_tokens), 0) >= ?)`,
          bronzeThreshold
        );
      }
      // Input tokens
      else if (def.id === "input-hog") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COALESCE(SUM(ur.input_tokens), 0) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COALESCE(SUM(ur.input_tokens), 0) >= ?)`,
          bronzeThreshold
        );
      }
      // Output tokens
      else if (def.id === "output-addict") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COALESCE(SUM(ur.output_tokens), 0) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COALESCE(SUM(ur.output_tokens), 0) >= ?)`,
          bronzeThreshold
        );
      }
      // Reasoning tokens
      else if (def.id === "reasoning-junkie") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COALESCE(SUM(ur.reasoning_output_tokens), 0) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COALESCE(SUM(ur.reasoning_output_tokens), 0) >= ?)`,
          bronzeThreshold
        );
      }
      // Veteran / Centurion (active days)
      else if (["veteran", "centurion"].includes(def.id)) {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COUNT(DISTINCT DATE(ur.hour_start)) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COUNT(DISTINCT DATE(ur.hour_start)) >= ?)`,
          bronzeThreshold
        );
      }
      // Diversity (sources, models, devices)
      else if (def.id === "tool-hoarder") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COUNT(DISTINCT ur.source) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COUNT(DISTINCT ur.source) >= ?)`,
          bronzeThreshold
        );
      }
      else if (def.id === "model-tourist") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COUNT(DISTINCT ur.model) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COUNT(DISTINCT ur.model) >= ?)`,
          bronzeThreshold
        );
      }
      else if (def.id === "device-nomad") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COUNT(DISTINCT ur.device_id) AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN usage_records ur ON ur.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COUNT(DISTINCT ur.device_id) >= ?)`,
          bronzeThreshold
        );
      }
      // Session-based achievements
      else if (def.id === "session-hoarder") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, COUNT(*) AS value
           FROM users u JOIN session_records sr ON sr.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN session_records sr ON sr.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING COUNT(*) >= ?)`,
          bronzeThreshold
        );
      }
      else if (def.id === "quick-draw") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, SUM(CASE WHEN sr.duration_seconds < 300 THEN 1 ELSE 0 END) AS value
           FROM users u JOIN session_records sr ON sr.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN session_records sr ON sr.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING SUM(CASE WHEN sr.duration_seconds < 300 THEN 1 ELSE 0 END) >= ?)`,
          bronzeThreshold
        );
      }
      else if (def.id === "marathon") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, SUM(CASE WHEN sr.duration_seconds > 7200 THEN 1 ELSE 0 END) AS value
           FROM users u JOIN session_records sr ON sr.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN session_records sr ON sr.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING SUM(CASE WHEN sr.duration_seconds > 7200 THEN 1 ELSE 0 END) >= ?)`,
          bronzeThreshold
        );
      }
      else if (def.id === "automation-addict") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug, SUM(CASE WHEN sr.kind = 'automated' THEN 1 ELSE 0 END) AS value
           FROM users u JOIN session_records sr ON sr.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (SELECT u.id FROM users u JOIN session_records sr ON sr.user_id = u.id WHERE u.is_public = 1 GROUP BY u.id HAVING SUM(CASE WHEN sr.kind = 'automated' THEN 1 ELSE 0 END) >= ?)`,
          bronzeThreshold
        );
      }
      // Big day — max tokens in a single day (using CTE)
      else if (def.id === "big-day") {
        await queryEarnedBy(
          def,
          `WITH daily AS (
             SELECT user_id, DATE(hour_start) AS day, SUM(total_tokens) AS day_tokens
             FROM usage_records GROUP BY user_id, DATE(hour_start)
           ), user_max AS (
             SELECT user_id, MAX(day_tokens) AS value FROM daily GROUP BY user_id
           )
           SELECT u.id, u.name, u.image, u.slug, um.value
           FROM users u JOIN user_max um ON um.user_id = u.id
           WHERE u.is_public = 1 AND um.value >= ?
           ORDER BY um.value DESC LIMIT ? OFFSET ?`,
          `WITH daily AS (
             SELECT user_id, DATE(hour_start) AS day, SUM(total_tokens) AS day_tokens
             FROM usage_records GROUP BY user_id, DATE(hour_start)
           ), user_max AS (
             SELECT user_id, MAX(day_tokens) AS value FROM daily GROUP BY user_id
           )
           SELECT COUNT(*) AS count FROM users u JOIN user_max um ON um.user_id = u.id
           WHERE u.is_public = 1 AND um.value >= ?`,
          bronzeThreshold
        );
      }
      // Chatterbox — max messages in a single session
      else if (def.id === "chatterbox") {
        await queryEarnedBy(
          def,
          `WITH user_max AS (
             SELECT user_id, MAX(total_messages) AS value FROM session_records GROUP BY user_id
           )
           SELECT u.id, u.name, u.image, u.slug, um.value
           FROM users u JOIN user_max um ON um.user_id = u.id
           WHERE u.is_public = 1 AND um.value >= ?
           ORDER BY um.value DESC LIMIT ? OFFSET ?`,
          `WITH user_max AS (
             SELECT user_id, MAX(total_messages) AS value FROM session_records GROUP BY user_id
           )
           SELECT COUNT(*) AS count FROM users u JOIN user_max um ON um.user_id = u.id
           WHERE u.is_public = 1 AND um.value >= ?`,
          bronzeThreshold
        );
      }
      // Cache master — cache hit rate percentage
      else if (def.id === "cache-master") {
        await queryEarnedBy(
          def,
          `SELECT u.id, u.name, u.image, u.slug,
                  CASE WHEN SUM(ur.input_tokens) > 0
                       THEN (SUM(ur.cached_input_tokens) * 100.0 / SUM(ur.input_tokens))
                       ELSE 0 END AS value
           FROM users u JOIN usage_records ur ON ur.user_id = u.id
           WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ? ORDER BY value DESC LIMIT ? OFFSET ?`,
          `SELECT COUNT(*) AS count FROM (
             SELECT u.id,
                    CASE WHEN SUM(ur.input_tokens) > 0
                         THEN (SUM(ur.cached_input_tokens) * 100.0 / SUM(ur.input_tokens))
                         ELSE 0 END AS value
             FROM users u JOIN usage_records ur ON ur.user_id = u.id
             WHERE u.is_public = 1 GROUP BY u.id HAVING value >= ?
           )`,
          bronzeThreshold
        );
      }
      // big-spender, daily-burn, streak: Skip - require runtime pricing lookup or complex date logic
    }
    } // end if (limit === null)

    // 6. Build response
    let achievements: AchievementResponse[] = ACHIEVEMENT_DEFS.map((def) => {
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

    // Apply limit if specified: sort by tier (highest first), then progress, and take top N
    if (limit !== null && limit > 0) {
      const tierRank: Record<AchievementTier, number> = {
        diamond: 4,
        gold: 3,
        silver: 2,
        bronze: 1,
        locked: 0,
      };
      achievements = [...achievements]
        .sort((a, b) => {
          const rankDiff = tierRank[b.tier] - tierRank[a.tier];
          if (rankDiff !== 0) return rankDiff;
          return b.progress - a.progress;
        })
        .slice(0, limit);
    }

    // Compute summary (based on full data, not limited)
    const allAchievements = ACHIEVEMENT_DEFS.map((def) => {
      const currentValue = values[def.id] ?? 0;
      const { tier } = computeTierProgress(currentValue, def.tiers);
      return { tier };
    });
    const totalUnlocked = allAchievements.filter((a) => a.tier !== "locked").length;
    const diamondCount = allAchievements.filter((a) => a.tier === "diamond").length;
    const longestStreak = computeLongestStreak(activeDays);

    return NextResponse.json({
      achievements,
      summary: {
        totalUnlocked,
        totalAchievements: ACHIEVEMENT_DEFS.length,
        diamondCount,
        currentStreak: streak,
        longestStreak,
        activeDays: activeDays.size,
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

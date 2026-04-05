/**
 * GET /api/users/[slug]/achievements — get public achievement progress for a specific user.
 *
 * Returns top 6 achievements (sorted by tier rank and progress) for display on profile.
 * Only works for users with is_public = 1.
 */

import { NextResponse } from "next/server";
import { getDbRead } from "@/lib/db";
import { getDefaultPricingMap, lookupPricing, type PricingMap } from "@/lib/pricing";
import {
  ACHIEVEMENT_DEFS,
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
  quick_sessions: number;
  marathon_sessions: number;
  max_messages: number;
  automated_sessions: number;
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

/** Tier rank for sorting: higher = better */
const TIER_RANK: Record<AchievementTier, number> = {
  locked: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
  diamond: 4,
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const db = await getDbRead();
  const pricingMap = getDefaultPricingMap();
  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1. Find user by slug (must be public)
    const user = await db.firstOrNull<{ id: string; name: string | null }>(
      `SELECT id, name FROM users WHERE (slug = ? OR id = ?) AND is_public = 1`,
      [slug, slug]
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = user.id;

    // 2. Query data (similar to /api/achievements but for specific user)
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

    const dailyUsage = await db.query<DailyUsageRow>(
      `SELECT DATE(hour_start) AS day, SUM(total_tokens) AS total_tokens
      FROM usage_records
      WHERE user_id = ?
      GROUP BY DATE(hour_start)
      ORDER BY day`,
      [userId]
    );

    const costByModelSourceDay = await db.query<{
      day: string;
      model: string;
      source: string | null;
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens: number;
    }>(
      `SELECT DATE(hour_start) AS day, model, source,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens
      FROM usage_records
      WHERE user_id = ?
      GROUP BY DATE(hour_start), model, source`,
      [userId]
    );

    const dailyCostMap = new Map<string, number>();
    for (const row of costByModelSourceDay.results) {
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

    const diversity = await db.firstOrNull<DiversityRow>(
      `SELECT
        COUNT(DISTINCT source) AS source_count,
        COUNT(DISTINCT model) AS model_count,
        COUNT(DISTINCT device_id) AS device_count
      FROM usage_records
      WHERE user_id = ?`,
      [userId]
    );

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

    const costByModelSource = await db.query<{
      model: string;
      source: string | null;
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens: number;
    }>(
      `SELECT model, source,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_input_tokens) AS cached_input_tokens
      FROM usage_records
      WHERE user_id = ?
      GROUP BY model, source`,
      [userId]
    );

    let totalCost = 0;
    for (const row of costByModelSource.results) {
      totalCost += computeCost(
        row.model,
        row.source,
        row.input_tokens,
        row.output_tokens,
        row.cached_input_tokens,
        pricingMap
      );
    }

    // 3. Compute achievement values
    const activeDays = new Set(dailyUsage.results.map((r) => r.day));
    const streak = computeStreak(activeDays, today);
    const biggestDay = dailyUsage.results.reduce(
      (max, r) => Math.max(max, r.total_tokens),
      0
    );
    const biggestDailyCost = Math.max(...dailyCostMap.values(), 0);

    const values: Record<string, number> = {
      "power-user": usageAgg?.total_tokens ?? 0,
      "big-day": biggestDay,
      "input-hog": usageAgg?.input_tokens ?? 0,
      "output-addict": usageAgg?.output_tokens ?? 0,
      "reasoning-junkie": usageAgg?.reasoning_output_tokens ?? 0,
      streak,
      veteran: activeDays.size,
      "weekend-warrior": 0, // Timezone-dependent, skip
      "night-owl": 0,
      "early-bird": 0,
      "cache-master":
        (usageAgg?.input_tokens ?? 0) > 0
          ? ((usageAgg?.cached_input_tokens ?? 0) / (usageAgg?.input_tokens ?? 1)) * 100
          : 0,
      "quick-draw": sessionAgg?.quick_sessions ?? 0,
      marathon: sessionAgg?.marathon_sessions ?? 0,
      "big-spender": totalCost,
      "daily-burn": biggestDailyCost,
      "tool-hoarder": diversity?.source_count ?? 0,
      "model-tourist": diversity?.model_count ?? 0,
      "device-nomad": diversity?.device_count ?? 0,
      chatterbox: sessionAgg?.max_messages ?? 0,
      "session-hoarder": sessionAgg?.total_sessions ?? 0,
      "automation-addict": sessionAgg?.automated_sessions ?? 0,
      "first-blood": usageAgg?.total_tokens ?? 0,
      centurion: activeDays.size,
      millionaire: usageAgg?.total_tokens ?? 0,
      billionaire: usageAgg?.total_tokens ?? 0,
    };

    // 4. Build achievements and sort by tier rank + progress
    const achievements: AchievementResponse[] = ACHIEVEMENT_DEFS
      .filter((def) => !def.isTimezoneDependant) // Exclude timezone-dependent
      .map((def) => {
        const currentValue = values[def.id] ?? 0;
        const { tier, progress, nextThreshold } = computeTierProgress(currentValue, def.tiers);

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
        };
      })
      .sort((a, b) => {
        // Sort by tier rank (descending), then by progress (descending)
        const tierDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
        if (tierDiff !== 0) return tierDiff;
        return b.progress - a.progress;
      });

    // 5. Return top 6 achievements for display
    const topAchievements = achievements.slice(0, 6);

    // Also compute summary
    const totalUnlocked = achievements.filter((a) => a.tier !== "locked").length;
    const diamondCount = achievements.filter((a) => a.tier === "diamond").length;

    return NextResponse.json({
      achievements: topAchievements,
      summary: {
        totalUnlocked,
        totalAchievements: achievements.length,
        diamondCount,
        currentStreak: streak,
      },
    });
  } catch (err) {
    console.error("Failed to compute user achievements:", err);
    return NextResponse.json(
      { error: "Failed to compute achievements" },
      { status: 500 }
    );
  }
}

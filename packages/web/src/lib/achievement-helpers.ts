/**
 * Achievement system — gamified milestones computed from usage data.
 *
 * Server-side computation via GET /api/achievements.
 * Each achievement has tiered thresholds (bronze -> silver -> gold -> diamond)
 * with a progress ring showing advancement toward the next tier.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tier levels for achievements, ordered by rank. */
export type AchievementTier = "locked" | "bronze" | "silver" | "gold" | "diamond";

/** Achievement category for grouping in UI. */
export type AchievementCategory =
  | "volume"
  | "consistency"
  | "efficiency"
  | "spending"
  | "diversity"
  | "sessions"
  | "special";

/** Static definition of an achievement kind. */
export interface AchievementDef {
  id: string;
  name: string;
  flavorText: string;
  icon: string;
  category: AchievementCategory;
  /** Threshold values for each tier (must be ascending). */
  tiers: readonly [bronze: number, silver: number, gold: number, diamond: number];
  /** Unit label for display (e.g. "days", "tokens", "$"). */
  unit: string;
  /** Format function for display values. */
  format: (value: number) => string;
  /**
   * If true, this achievement requires user timezone to compute accurately.
   * These achievements are excluded from social features (earnedBy, members endpoint).
   */
  isTimezoneDependant?: boolean;
}

/** Computed state of a single achievement. */
export interface AchievementState {
  id: string;
  name: string;
  flavorText: string;
  icon: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** Current value (e.g. 14 for a 14-day streak). */
  currentValue: number;
  /** Threshold for the next tier, or current tier threshold if maxed. */
  nextThreshold: number;
  /** Progress toward next tier: 0-1. 1.0 when at diamond. */
  progress: number;
  /** Human-readable current value. */
  displayValue: string;
  /** Human-readable next threshold. */
  displayThreshold: string;
  /** Tier label for display. */
  tierLabel: string;
  unit: string;
  /** If true, excluded from social features. */
  isTimezoneDependant: boolean;
}

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

export const TIER_LABELS: Record<AchievementTier, string> = {
  locked: "Locked",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
};

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  volume: "Volume",
  consistency: "Consistency",
  efficiency: "Efficiency",
  spending: "Spending",
  diversity: "Diversity",
  sessions: "Sessions",
  special: "Special",
};

/**
 * Determine the current tier and progress from a value and tier thresholds.
 *
 * @param value - current metric value
 * @param tiers - [bronze, silver, gold, diamond] thresholds (ascending)
 */
export function computeTierProgress(
  value: number,
  tiers: readonly [number, number, number, number]
): { tier: AchievementTier; progress: number; nextThreshold: number } {
  const [bronze, silver, gold, diamond] = tiers;

  if (value >= diamond) {
    return { tier: "diamond", progress: 1, nextThreshold: diamond };
  }
  if (value >= gold) {
    return {
      tier: "gold",
      progress: (value - gold) / (diamond - gold),
      nextThreshold: diamond,
    };
  }
  if (value >= silver) {
    return {
      tier: "silver",
      progress: (value - silver) / (gold - silver),
      nextThreshold: gold,
    };
  }
  if (value >= bronze) {
    return {
      tier: "bronze",
      progress: (value - bronze) / (silver - bronze),
      nextThreshold: silver,
    };
  }

  // Not yet unlocked - progress toward bronze
  return {
    tier: "locked",
    progress: bronze > 0 ? value / bronze : 0,
    nextThreshold: bronze,
  };
}

// ---------------------------------------------------------------------------
// Format functions
// ---------------------------------------------------------------------------

export function formatDays(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

export function formatShortTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function formatDollars(n: number): string {
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

export function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

export function formatSessions(n: number): string {
  return n === 1 ? "1 session" : `${n} sessions`;
}

export function formatHours(n: number): string {
  return n === 1 ? "1 hour" : `${n} hours`;
}

export function formatMessages(n: number): string {
  return n === 1 ? "1 msg" : `${n} msgs`;
}

export function formatCount(n: number): string {
  return String(n);
}

// ---------------------------------------------------------------------------
// Achievement definitions (25 total)
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  // -------------------------------------------------------------------------
  // Category: Volume (Token Gluttony) - 5 achievements
  // -------------------------------------------------------------------------
  {
    id: "power-user",
    name: "Insatiable",
    flavorText: "Your wallet weeps. Your AI rejoices.",
    icon: "Zap",
    category: "volume",
    tiers: [100_000, 1_000_000, 10_000_000, 50_000_000],
    unit: "tokens",
    format: formatShortTokens,
  },
  {
    id: "big-day",
    name: "One More Turn",
    flavorText: "You said 'just one more prompt' 47 times.",
    icon: "Trophy",
    category: "volume",
    tiers: [10_000, 50_000, 100_000, 500_000],
    unit: "tokens/day",
    format: formatShortTokens,
  },
  {
    id: "input-hog",
    name: "The Novelist",
    flavorText: "Did you just paste your entire codebase again?",
    icon: "FileText",
    category: "volume",
    tiers: [50_000, 200_000, 1_000_000, 5_000_000],
    unit: "input",
    format: formatShortTokens,
  },
  {
    id: "output-addict",
    name: "Attention Seeker",
    flavorText: "You could've read the docs. But no.",
    icon: "MessageSquare",
    category: "volume",
    tiers: [50_000, 200_000, 1_000_000, 5_000_000],
    unit: "output",
    format: formatShortTokens,
  },
  {
    id: "reasoning-junkie",
    name: "Overthinker",
    flavorText: "Watching an AI think about thinking.",
    icon: "Brain",
    category: "volume",
    tiers: [10_000, 100_000, 500_000, 2_000_000],
    unit: "reasoning",
    format: formatShortTokens,
  },

  // -------------------------------------------------------------------------
  // Category: Consistency (The Grind) - 5 achievements
  // -------------------------------------------------------------------------
  {
    id: "streak",
    name: "On Fire",
    flavorText: "Your streak is alive. Your social life is not.",
    icon: "Flame",
    category: "consistency",
    tiers: [3, 7, 14, 30],
    unit: "days",
    format: formatDays,
  },
  {
    id: "veteran",
    name: "No Life",
    flavorText: "You've been here longer than some marriages.",
    icon: "Calendar",
    category: "consistency",
    tiers: [7, 30, 90, 365],
    unit: "days",
    format: formatDays,
  },
  {
    id: "weekend-warrior",
    name: "No Rest for the Wicked",
    flavorText: "Saturday? More like Codeturday.",
    icon: "Sunset",
    category: "consistency",
    tiers: [4, 12, 26, 52],
    unit: "weekend days",
    format: formatDays,
    isTimezoneDependant: true,
  },
  {
    id: "night-owl",
    name: "Sleep is Overrated",
    flavorText: "2AM prompt submitted. 2:01AM regret.",
    icon: "Moon",
    category: "consistency",
    tiers: [10, 30, 100, 300],
    unit: "hours",
    format: formatHours,
    isTimezoneDependant: true,
  },
  {
    id: "early-bird",
    name: "Dawn Debugger",
    flavorText: "The AI was your first conversation today.",
    icon: "Sunrise",
    category: "consistency",
    tiers: [10, 30, 100, 300],
    unit: "hours",
    format: formatHours,
    isTimezoneDependant: true,
  },

  // -------------------------------------------------------------------------
  // Category: Efficiency (Copium) - 3 achievements
  // -------------------------------------------------------------------------
  {
    id: "cache-master",
    name: "Recycler",
    flavorText: "At least SOMETHING is being reused.",
    icon: "Shield",
    category: "efficiency",
    tiers: [10, 25, 50, 75],
    unit: "%",
    format: formatPercent,
  },
  {
    id: "quick-draw",
    name: "One and Done",
    flavorText: "In, out, shipped. Respect.",
    icon: "Zap",
    category: "efficiency",
    tiers: [10, 50, 200, 500],
    unit: "sessions",
    format: formatSessions,
  },
  {
    id: "marathon",
    name: "Send Help",
    flavorText: "This session is older than some startups.",
    icon: "Clock",
    category: "efficiency",
    tiers: [1, 5, 20, 50],
    unit: "sessions",
    format: formatSessions,
  },

  // -------------------------------------------------------------------------
  // Category: Spending (Financial Ruin) - 2 achievements
  // -------------------------------------------------------------------------
  {
    id: "big-spender",
    name: "API Baron",
    flavorText: "Anthropic sends you a Christmas card.",
    icon: "DollarSign",
    category: "spending",
    tiers: [1, 10, 50, 100],
    unit: "$",
    format: formatDollars,
  },
  {
    id: "daily-burn",
    name: "Money Printer",
    flavorText: "Your daily API bill could feed a small village.",
    icon: "TrendingUp",
    category: "spending",
    tiers: [0.5, 2, 10, 50],
    unit: "$/day",
    format: formatDollars,
  },

  // -------------------------------------------------------------------------
  // Category: Diversity (Tool Hoarding) - 3 achievements
  // -------------------------------------------------------------------------
  {
    id: "tool-hoarder",
    name: "Commitment Issues",
    flavorText: "You've tried every CLI tool. Twice.",
    icon: "Wrench",
    category: "diversity",
    tiers: [2, 4, 5, 7],
    unit: "sources",
    format: formatCount,
  },
  {
    id: "model-tourist",
    name: "Model Agnostic",
    flavorText: "Opus? Sonnet? Haiku? Yes.",
    icon: "Layers",
    category: "diversity",
    tiers: [3, 5, 8, 12],
    unit: "models",
    format: formatCount,
  },
  {
    id: "device-nomad",
    name: "Work From Anywhere",
    flavorText: "Your code runs on 4 different machines. None of them work.",
    icon: "Monitor",
    category: "diversity",
    tiers: [2, 3, 5, 8],
    unit: "devices",
    format: formatCount,
  },

  // -------------------------------------------------------------------------
  // Category: Sessions (Conversation Crimes) - 3 achievements
  // -------------------------------------------------------------------------
  {
    id: "chatterbox",
    name: "Verbose Mode",
    flavorText: "Your sessions have more messages than group chats.",
    icon: "MessageCircle",
    category: "sessions",
    tiers: [50, 100, 500, 1000],
    unit: "msgs/session",
    format: formatMessages,
  },
  {
    id: "session-hoarder",
    name: "Context Collector",
    flavorText: "You've started more sessions than you've finished.",
    icon: "Inbox",
    category: "sessions",
    tiers: [100, 500, 2000, 10000],
    unit: "sessions",
    format: formatSessions,
  },
  {
    id: "automation-addict",
    name: "The Machine",
    flavorText: "Let the robots talk to the robots.",
    icon: "Bot",
    category: "sessions",
    tiers: [10, 50, 200, 1000],
    unit: "sessions",
    format: formatSessions,
  },

  // -------------------------------------------------------------------------
  // Category: Special (Hidden / Rare) - 4 achievements
  // -------------------------------------------------------------------------
  {
    id: "first-blood",
    name: "Hello World",
    flavorText: "Your first token. The gateway drug.",
    icon: "Sparkles",
    category: "special",
    tiers: [1, 1, 1, 1], // Single-tier: any usage unlocks diamond
    unit: "tokens",
    format: formatShortTokens,
  },
  {
    id: "centurion",
    name: "Triple Digits",
    flavorText: "Day 100. Still no exit strategy.",
    icon: "Award",
    category: "special",
    tiers: [100, 100, 100, 100], // Single-tier: 100 days = diamond
    unit: "days",
    format: formatDays,
  },
  {
    id: "millionaire",
    name: "Club 1M",
    flavorText: "Welcome to the club nobody wanted to join.",
    icon: "Crown",
    category: "special",
    tiers: [1_000_000, 1_000_000, 1_000_000, 1_000_000], // Single-tier
    unit: "tokens",
    format: formatShortTokens,
  },
  {
    id: "billionaire",
    name: "Tokens Go Brrrr",
    flavorText: "Seriously, are you okay?",
    icon: "Rocket",
    category: "special",
    tiers: [1_000_000_000, 1_000_000_000, 1_000_000_000, 1_000_000_000], // Aspirational
    unit: "tokens",
    format: formatShortTokens,
  },
] as const;

/** IDs of achievements that require timezone and are excluded from social features. */
export const TIMEZONE_DEPENDANT_IDS = new Set(
  ACHIEVEMENT_DEFS.filter((d) => d.isTimezoneDependant).map((d) => d.id)
);

/** Get achievement definition by ID. */
export function getAchievementDef(id: string): AchievementDef | undefined {
  return ACHIEVEMENT_DEFS.find((d) => d.id === id);
}

/**
 * Compute achievement state from a value and definition.
 */
export function computeAchievementState(
  def: AchievementDef,
  currentValue: number
): AchievementState {
  const { tier, progress, nextThreshold } = computeTierProgress(
    currentValue,
    def.tiers
  );

  return {
    id: def.id,
    name: def.name,
    flavorText: def.flavorText,
    icon: def.icon,
    category: def.category,
    tier,
    currentValue,
    nextThreshold,
    progress,
    displayValue: def.format(currentValue),
    displayThreshold: def.format(nextThreshold),
    tierLabel: TIER_LABELS[tier],
    unit: def.unit,
    isTimezoneDependant: def.isTimezoneDependant ?? false,
  };
}

// ---------------------------------------------------------------------------
// Legacy compatibility layer (for dashboard until Phase 4)
// ---------------------------------------------------------------------------

import type { UsageRow, UsageSummary, ModelAggregate } from "@/hooks/use-usage-data";
import type { PricingMap } from "@/lib/pricing";
import { computeTotalCost } from "@/lib/cost-helpers";
import { computeStreak, toLocalDailyBuckets } from "@/lib/usage-helpers";

/** @deprecated Use server-side /api/achievements instead */
export interface AchievementInputs {
  rows: UsageRow[];
  summary: UsageSummary;
  models: ModelAggregate[];
  pricingMap: PricingMap;
  tzOffset?: number;
  today?: string;
}

/** Legacy achievement IDs supported by client-side computation */
const LEGACY_ACHIEVEMENT_IDS = new Set([
  "streak",
  "big-day",
  "power-user",
  "big-spender",
  "veteran",
  "cache-master",
]);

/**
 * @deprecated Use server-side /api/achievements instead.
 * Extract the raw metric value for each legacy achievement from input data.
 */
export function extractAchievementValues(
  inputs: AchievementInputs
): Record<string, number> {
  const { rows, summary, models, pricingMap, today } = inputs;

  // Streak — current streak from 365-day data (UTC-based per Decision)
  const streak = computeStreak(rows, today, 0);

  // Big Day — max daily tokens across all days (UTC-based)
  const buckets = toLocalDailyBuckets(rows, 0);
  const biggestDay = buckets.reduce(
    (max, b) => Math.max(max, b.totalTokens),
    0
  );

  // Power User — total tokens
  const totalTokens = summary.total_tokens;

  // Big Spender — total estimated cost
  const totalCost = computeTotalCost(models, pricingMap);

  // Veteran — unique active days (UTC-based)
  const activeDays = buckets.length;

  // Cache Master — cache hit rate %
  const cacheRate =
    summary.input_tokens > 0
      ? (summary.cached_input_tokens / summary.input_tokens) * 100
      : 0;

  return {
    streak: streak.currentStreak,
    "big-day": biggestDay,
    "power-user": totalTokens,
    "big-spender": totalCost,
    veteran: activeDays,
    "cache-master": cacheRate,
  };
}

/**
 * @deprecated Use server-side /api/achievements instead.
 * Compute the state of legacy achievements from usage data.
 * Returns only the original 6 achievements for backward compatibility.
 */
export function computeAchievements(
  inputs: AchievementInputs
): AchievementState[] {
  const values = extractAchievementValues(inputs);

  return ACHIEVEMENT_DEFS.filter((def) => LEGACY_ACHIEVEMENT_IDS.has(def.id)).map(
    (def) => computeAchievementState(def, values[def.id] ?? 0)
  );
}

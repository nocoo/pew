"use client";

import {
  Flame,
  Trophy,
  Zap,
  DollarSign,
  Calendar,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AchievementState, AchievementTier } from "@/lib/achievement-helpers";

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Flame,
  Trophy,
  Zap,
  DollarSign,
  Calendar,
  Shield,
};

// ---------------------------------------------------------------------------
// Tier visual system — more dramatic gradients and styling
// ---------------------------------------------------------------------------

const TIER_STYLES: Record<AchievementTier, {
  /** Background gradient (for the icon container) */
  gradient: string;
  /** Icon color */
  iconColor: string;
  /** Ring/progress color */
  ringColor: string;
  /** Glow effect class */
  glow: string;
  /** Badge text color */
  badgeColor: string;
}> = {
  locked: {
    gradient: "from-muted/50 to-muted/30",
    iconColor: "text-muted-foreground/50",
    ringColor: "stroke-muted-foreground/30",
    glow: "",
    badgeColor: "text-muted-foreground",
  },
  bronze: {
    gradient: "from-chart-7/30 to-chart-7/10",
    iconColor: "text-chart-7",
    ringColor: "stroke-chart-7",
    glow: "shadow-[0_0_12px_-2px] shadow-chart-7/30",
    badgeColor: "text-chart-7",
  },
  silver: {
    gradient: "from-chart-2/30 to-chart-2/10",
    iconColor: "text-chart-2",
    ringColor: "stroke-chart-2",
    glow: "shadow-[0_0_12px_-2px] shadow-chart-2/30",
    badgeColor: "text-chart-2",
  },
  gold: {
    gradient: "from-chart-6/30 to-chart-6/10",
    iconColor: "text-chart-6",
    ringColor: "stroke-chart-6",
    glow: "shadow-[0_0_16px_-2px] shadow-chart-6/40",
    badgeColor: "text-chart-6",
  },
  diamond: {
    gradient: "from-primary/30 to-chart-8/20",
    iconColor: "text-primary",
    ringColor: "stroke-primary",
    glow: "shadow-[0_0_20px_-2px] shadow-primary/50",
    badgeColor: "text-primary",
  },
};

// ---------------------------------------------------------------------------
// Circular Progress with Icon
// ---------------------------------------------------------------------------

const RING_SIZE = 56;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface AchievementRingProps {
  progress: number;
  tier: AchievementTier;
  icon: string;
}

function AchievementRing({ progress, tier, icon }: AchievementRingProps) {
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  const styles = TIER_STYLES[tier];
  const Icon = ICON_MAP[icon];
  const isUnlocked = tier !== "locked";

  return (
    <div className={cn("relative inline-flex items-center justify-center", styles.glow, "rounded-full")}>
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="-rotate-90"
      >
        {/* Background track */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          className="stroke-muted-foreground/10"
        />
        {/* Progress arc */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          className={cn(styles.ringColor, "transition-[stroke-dashoffset] duration-700 ease-out")}
        />
      </svg>
      {/* Icon in center */}
      <div className={cn(
        "absolute inset-2 rounded-full bg-gradient-to-br flex items-center justify-center",
        styles.gradient
      )}>
        {Icon && (
          <Icon
            className={cn("h-5 w-5", styles.iconColor, isUnlocked && tier !== "bronze" && "drop-shadow-sm")}
            strokeWidth={1.5}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AchievementCard — Compact visual card for sidebar display
// ---------------------------------------------------------------------------

export interface AchievementCardProps {
  achievement: AchievementState;
  className?: string;
}

/**
 * Compact achievement card for sidebar/right-rail display.
 * Shows icon ring, name, current value, and tier badge.
 */
export function AchievementCard({ achievement, className }: AchievementCardProps) {
  const styles = TIER_STYLES[achievement.tier];
  const isUnlocked = achievement.tier !== "locked";
  const isMaxed = achievement.tier === "diamond";
  const pct = Math.round(achievement.progress * 100);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl p-3 transition-colors",
        isUnlocked ? "bg-card/50 hover:bg-card" : "bg-muted/30",
        className
      )}
    >
      {/* Ring with icon */}
      <AchievementRing
        progress={achievement.progress}
        tier={achievement.tier}
        icon={achievement.icon}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-sm font-medium truncate",
            isUnlocked ? "text-foreground" : "text-muted-foreground"
          )}>
            {achievement.name}
          </span>
          {isUnlocked && (
            <span className={cn(
              "shrink-0 text-[10px] font-semibold uppercase tracking-wider",
              styles.badgeColor
            )}>
              {achievement.tierLabel}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums">{achievement.displayValue}</span>
          {!isMaxed && (
            <>
              <span>/</span>
              <span className="tabular-nums">{achievement.displayThreshold}</span>
              <span>{achievement.unit}</span>
              <span className="ml-auto tabular-nums">{pct}%</span>
            </>
          )}
          {isMaxed && (
            <span className="flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" strokeWidth={2} />
              Max
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AchievementPanel — Vertical stack for Hero sidebar
// ---------------------------------------------------------------------------

export interface AchievementPanelProps {
  achievements: AchievementState[];
  className?: string;
}

/**
 * Vertical panel of achievement cards for the Hero section sidebar.
 * Shows the top achievements (unlocked first, then by progress).
 */
export function AchievementPanel({ achievements, className }: AchievementPanelProps) {
  if (achievements.length === 0) return null;

  // Sort: unlocked achievements first (by tier rank desc), then locked (by progress desc)
  const tierRank: Record<AchievementTier, number> = {
    diamond: 4,
    gold: 3,
    silver: 2,
    bronze: 1,
    locked: 0,
  };

  const sorted = [...achievements].sort((a, b) => {
    const rankDiff = tierRank[b.tier] - tierRank[a.tier];
    if (rankDiff !== 0) return rankDiff;
    return b.progress - a.progress;
  });

  // Show top 4 achievements (or all if fewer)
  const display = sorted.slice(0, 4);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Achievements
        </span>
      </div>
      {display.map((ach) => (
        <AchievementCard key={ach.id} achievement={ach} />
      ))}
    </div>
  );
}

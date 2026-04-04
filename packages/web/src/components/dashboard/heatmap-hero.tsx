"use client";

import { useMemo } from "react";
import { Flame, Zap, Calendar } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { HeatmapCalendar, type HeatmapDataPoint } from "./heatmap-calendar";
import { AchievementPanel } from "./achievement-panel";
import { Skeleton } from "@/components/ui/skeleton";
import type { AchievementState } from "@/lib/achievement-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeatmapHeroProps {
  /** Heatmap data points (date + value pairs) */
  data: HeatmapDataPoint[];
  /** Year to display */
  year: number;
  /** Total tokens for the year */
  totalTokens: number;
  /** Current streak in days (0 = no streak) */
  currentStreak: number;
  /** Longest streak ever achieved */
  longestStreak: number;
  /** Number of active days in the year */
  activeDays: number;
  /** Achievement states to display in sidebar */
  achievements?: AchievementState[];
  /** Loading state */
  loading?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Streak Badge — fire emoji with pulsing glow when active
// ---------------------------------------------------------------------------

function StreakBadge({
  current,
  longest,
}: {
  current: number;
  longest: number;
}) {
  const isActive = current > 0;
  const isPersonalBest = current > 0 && current >= longest;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1",
          isActive
            ? "bg-chart-5/15 text-chart-5"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Flame
          className={cn(
            "h-4 w-4",
            isActive && "animate-pulse"
          )}
          strokeWidth={1.5}
        />
        <span className="text-sm font-semibold tabular-nums">
          {current}
        </span>
        <span className="text-xs opacity-70">
          day{current !== 1 ? "s" : ""}
        </span>
      </div>
      {isPersonalBest && current > 3 && (
        <span className="text-[10px] font-medium text-chart-6 uppercase tracking-wider">
          Personal Best!
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini Stat — compact metric display
// ---------------------------------------------------------------------------

function MiniStat({
  icon: Icon,
  value,
  label,
  className,
}: {
  icon: typeof Zap;
  value: string | number;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeatmapHero Component
// ---------------------------------------------------------------------------

/**
 * Hero section featuring the contribution heatmap as the primary visual,
 * with achievements displayed in a right sidebar.
 *
 * Layout:
 * - Left: Heatmap with year stats and streak badge
 * - Right: Achievement panel (on large screens)
 *
 * Displays:
 * - Large year total token count
 * - Current streak with fire indicator
 * - Activity heatmap (GitHub-style)
 * - Quick stats (active days, longest streak)
 * - Achievement cards with progress rings
 */
export function HeatmapHero({
  data,
  year,
  totalTokens,
  currentStreak,
  longestStreak,
  activeDays,
  achievements = [],
  loading = false,
  className,
}: HeatmapHeroProps) {
  // Calculate days in year so far
  const daysInYear = useMemo(() => {
    const now = new Date();
    const startOfYear = new Date(year, 0, 1);
    if (now.getFullYear() > year) {
      // Past year — full 365/366 days
      const endOfYear = new Date(year, 11, 31);
      return Math.ceil((endOfYear.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }
    // Current year — days elapsed
    return Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
  }, [year]);

  const activityRate = daysInYear > 0 ? Math.round((activeDays / daysInYear) * 100) : 0;
  const hasAchievements = achievements.length > 0;

  if (loading) {
    return (
      <div className={cn("rounded-[var(--radius-card)] bg-secondary p-4 md:p-6", className)}>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: Heatmap skeleton */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-4">
              <div className="space-y-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-5 w-48" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-[120px] w-full" />
            <div className="mt-4 flex gap-6 border-t border-border/50 pt-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
          {/* Right: Achievements skeleton */}
          <div className="lg:w-[280px] shrink-0 space-y-2">
            <Skeleton className="h-5 w-24 mb-3" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-[var(--radius-card)] bg-secondary p-4 md:p-6", className)}>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: Heatmap section */}
        <div className="flex-1 min-w-0">
          {/* Header row: Year total + Streak badge */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl md:text-4xl font-bold font-display tracking-tight text-foreground">
                  {formatTokens(totalTokens)}
                </span>
                <span className="text-sm text-muted-foreground">tokens</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {year} contribution · {activityRate}% active days
              </p>
            </div>
            <StreakBadge current={currentStreak} longest={longestStreak} />
          </div>

          {/* Heatmap */}
          <HeatmapCalendar
            data={data}
            year={year}
            valueFormatter={(v) => formatTokens(v)}
            metricLabel="Tokens"
          />

          {/* Footer stats */}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/50 pt-4">
            <MiniStat icon={Calendar} value={activeDays} label="active days" />
            <MiniStat icon={Flame} value={longestStreak} label="longest streak" />
            <MiniStat
              icon={Zap}
              value={activeDays > 0 ? formatTokens(Math.round(totalTokens / activeDays)) : "0"}
              label="avg per active day"
            />
          </div>
        </div>

        {/* Right: Achievements panel (large screens only, or below on mobile) */}
        {hasAchievements && (
          <div className="lg:w-[280px] shrink-0 lg:border-l lg:border-border/50 lg:pl-6">
            <AchievementPanel achievements={achievements} />
          </div>
        )}
      </div>
    </div>
  );
}

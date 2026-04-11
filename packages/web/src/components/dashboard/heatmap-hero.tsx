"use client";

import { useMemo } from "react";
import { Flame, Zap, Calendar, Activity } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { HeatmapCalendar, type HeatmapDataPoint } from "./heatmap-calendar";
import { TopAchievement } from "./top-achievement";
import { GoalHeatmap } from "./goal-heatmap";
import { Skeleton } from "@/components/ui/skeleton";
import type { Achievement } from "@/hooks/use-achievements";

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
  /** Achievement data from server (optional — if not provided, panel is hidden) */
  achievements?: Achievement[];
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
      <div className={cn("grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4", className)}>
        {/* Left: Activity skeleton */}
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="flex items-start justify-between mb-3">
            <div className="space-y-1">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-[120px] w-full" />
          <div className="mt-3 flex gap-5 border-t border-border/50 pt-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
        {/* Center: Goal skeleton */}
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="space-y-1 mb-3">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-[120px] w-full" />
          <div className="mt-3 flex gap-4 border-t border-border/50 pt-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        {/* Right: Achievements skeleton */}
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-2">
          <Skeleton className="h-4 w-28 mb-3" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "grid grid-cols-1 gap-3 md:gap-4",
      hasAchievements ? "lg:grid-cols-3" : "lg:grid-cols-2",
      className,
    )}>
      {/* Left: Activity card */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 min-w-0 flex flex-col">
        {/* Section title — height matches Goal Tracker (h-7 placeholder for alignment) */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Activity
            </span>
          </div>
          <div className="h-7 w-7 shrink-0" aria-hidden="true" />
        </div>

        {/* Header row: Year total + Streak badge — fixed height for alignment */}
        <div className="flex items-start justify-between gap-2 mb-3 h-14">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl md:text-3xl font-bold font-display tracking-tight text-foreground">
                {formatTokens(totalTokens)}
              </span>
              <span className="text-xs text-muted-foreground">tokens</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {year} contribution · {activityRate}% active days
            </p>
          </div>
          <StreakBadge current={currentStreak} longest={longestStreak} />
        </div>

        {/* Heatmap — flex-1 to push footer down */}
        <div className="flex-1">
          <HeatmapCalendar
            data={data}
            year={year}
            valueFormatter={(v) => formatTokens(v)}
            metricLabel="Tokens"
          />
        </div>

        {/* Footer stats — fixed height for alignment across cards */}
        <div className="mt-auto flex h-10 flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/50 pt-3">
          <MiniStat icon={Calendar} value={activeDays} label="active days" />
          <MiniStat icon={Flame} value={longestStreak} label="longest streak" />
          <MiniStat
            icon={Zap}
            value={activeDays > 0 ? formatTokens(Math.round(totalTokens / activeDays)) : "0"}
            label="avg per active day"
          />
        </div>
      </div>

      {/* Center: Goal Tracker card */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 min-w-0 flex flex-col">
        <GoalHeatmap data={data} year={year} className="flex-1" />
      </div>

      {/* Right: Top Achievements card */}
      {hasAchievements && (
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 flex flex-col">
          <TopAchievement achievements={achievements} className="flex-1" />
        </div>
      )}
    </div>
  );
}

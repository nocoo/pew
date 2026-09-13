"use client";

import { useMemo } from "react";
import { Zap, Calendar, Activity } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { HeatmapCalendar, type HeatmapDataPoint } from "./heatmap-calendar";
import { GoalHeatmap } from "./goal-heatmap";
import { Skeleton } from "@/components/ui/skeleton";

export interface HeatmapHeroProps {
  data: HeatmapDataPoint[];
  year: number;
  totalTokens: number;
  activeDays: number;
  loading?: boolean;
  className?: string;
}

function MiniStat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Zap;
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-xs text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{value}</span>
        {" "}{label}
      </span>
    </div>
  );
}

/** Activity and goal heatmaps share the same year-to-date usage data. */
export function HeatmapHero({
  data,
  year,
  totalTokens,
  activeDays,
  loading = false,
  className,
}: HeatmapHeroProps) {
  const daysInYear = useMemo(() => {
    const now = new Date();
    const end = now.getFullYear() > year
      ? Date.UTC(year + 1, 0, 1)
      : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return (end - Date.UTC(year, 0, 1)) / 86_400_000;
  }, [year]);
  const activityRate = daysInYear > 0 ? Math.round((activeDays / daysInYear) * 100) : 0;

  if (loading) {
    return (
      <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4", className)}>
        {["Activity", "Goal Tracker"].map((label) => (
          <section key={label} aria-label={label} aria-busy="true" className="rounded-card bg-secondary p-4 md:p-5 min-w-0">
            <div className="flex h-7 items-center mb-3">
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="space-y-1 mb-3 h-14">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-[140px] w-full" />
            <div className="mt-3 flex gap-5 border-t border-border/50 pt-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4", className)}>
      <section aria-label="Activity" className="rounded-card bg-secondary p-4 md:p-5 min-w-0 flex flex-col">
        <div className="flex h-7 items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Activity
          </span>
        </div>

        <div className="mb-3 h-14">
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

        <div className="flex-1">
          <HeatmapCalendar
            data={data}
            year={year}
            valueFormatter={(v) => formatTokens(v)}
            metricLabel="Tokens"
          />
        </div>

        <div className="mt-auto flex min-h-10 flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/50 pt-3">
          <MiniStat icon={Calendar} value={activeDays} label="active days" />
          <MiniStat
            icon={Zap}
            value={activeDays > 0 ? formatTokens(Math.round(totalTokens / activeDays)) : "0"}
            label="avg per active day"
          />
        </div>
      </section>

      <section aria-label="Goal Tracker" className="rounded-card bg-secondary p-4 md:p-5 min-w-0 flex flex-col">
        <GoalHeatmap data={data} year={year} className="flex-1" />
      </section>
    </div>
  );
}

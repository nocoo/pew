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
          <section key={label} aria-label={label} aria-busy="true" className="rounded-card bg-secondary p-4 min-w-0">
            <div className="mb-3 flex h-12 items-center justify-between">
              <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-32" /></div>
              <Skeleton className="h-8 w-16" />
            </div>
            <Skeleton className="h-[142px] w-full" />
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
      <section aria-label="Activity" className="rounded-card bg-secondary p-4 min-w-0 flex flex-col">
        <div className="mb-3 flex min-h-12 items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Activity</span>
            </div>
            <p className="text-xs text-muted-foreground">{year} · {activityRate}% active days</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="text-2xl font-bold font-display tracking-tight text-foreground">
              {formatTokens(totalTokens)}
            </span>
            <p className="text-xs text-muted-foreground">tokens</p>
          </div>
        </div>

        <div className="flex-1">
          <HeatmapCalendar
            data={data}
            year={year}
            valueFormatter={(v) => formatTokens(v)}
            metricLabel="Tokens"
          />
        </div>

        <div className="mt-3 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-2">
          <MiniStat icon={Calendar} value={activeDays} label="active days" />
          <MiniStat
            icon={Zap}
            value={activeDays > 0 ? formatTokens(Math.round(totalTokens / activeDays)) : "0"}
            label="avg per active day"
          />
        </div>
      </section>

      <section aria-label="Goal Tracker" className="rounded-card bg-secondary p-4 min-w-0 flex flex-col">
        <GoalHeatmap data={data} year={year} className="flex-1" />
      </section>
    </div>
  );
}

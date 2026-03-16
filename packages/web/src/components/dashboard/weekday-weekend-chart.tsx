"use client";

import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { formatCost } from "@/lib/pricing";
import { chart } from "@/lib/palette";
import type { WeekdayWeekendStats } from "@/lib/usage-helpers";
import { CalendarRange } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeekdayWeekendChartProps {
  stats: WeekdayWeekendStats;
  className?: string;
}

// ---------------------------------------------------------------------------
// Comparison bar — a single metric row showing weekday vs weekend
// ---------------------------------------------------------------------------

function ComparisonRow({
  label,
  weekdayValue,
  weekendValue,
  formatter,
  color,
}: {
  label: string;
  weekdayValue: number;
  weekendValue: number;
  formatter: (v: number) => string;
  color: string;
}) {
  const maxVal = Math.max(weekdayValue, weekendValue, 1);
  const weekdayPct = (weekdayValue / maxVal) * 100;
  const weekendPct = (weekendValue / maxVal) * 100;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">
            Weekday
          </span>
          <div className="flex-1 h-5 rounded bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded transition-all duration-500"
              style={{ width: `${weekdayPct}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">
            {formatter(weekdayValue)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">
            Weekend
          </span>
          <div className="flex-1 h-5 rounded bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded transition-all duration-500"
              style={{
                width: `${weekendPct}%`,
                backgroundColor: color,
                opacity: 0.55,
              }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">
            {formatter(weekendValue)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Side-by-side horizontal bar comparison of weekday vs weekend averages.
 * Two rows: Avg Tokens and Avg Cost, each with a proportional bar.
 */
export function WeekdayWeekendChart({
  stats,
  className,
}: WeekdayWeekendChartProps) {
  const isEmpty =
    stats.weekday.totalDays === 0 && stats.weekend.totalDays === 0;

  if (isEmpty) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No weekday/weekend data yet
      </div>
    );
  }

  // Ratio label: "2.3x more on weekdays" or "1.5x more on weekends"
  let ratioLabel: string | null = null;
  if (stats.ratio > 0 && stats.ratio !== 1 && isFinite(stats.ratio)) {
    if (stats.ratio >= 1) {
      ratioLabel = `${stats.ratio.toFixed(1)}x more on weekdays`;
    } else {
      ratioLabel = `${(1 / stats.ratio).toFixed(1)}x more on weekends`;
    }
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      {/* Header: icon + title */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <CalendarRange
            className="h-4 w-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <p className="text-xs md:text-sm text-muted-foreground">
            Weekday vs Weekend
          </p>
        </div>
        {ratioLabel && (
          <span className="text-xs text-muted-foreground/60">
            {ratioLabel}
          </span>
        )}
      </div>

      {/* Two comparison rows */}
      <div className="space-y-4">
        <ComparisonRow
          label="Avg Daily Tokens"
          weekdayValue={stats.weekday.avgTokens}
          weekendValue={stats.weekend.avgTokens}
          formatter={formatTokens}
          color={chart.teal}
        />
        <ComparisonRow
          label="Avg Daily Cost"
          weekdayValue={stats.weekday.avgCost}
          weekendValue={stats.weekend.avgCost}
          formatter={formatCost}
          color={chart.sky}
        />
      </div>
    </div>
  );
}

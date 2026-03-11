"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { formatCost } from "@/lib/pricing";
import { chart, chartAxis, chartMuted } from "@/lib/palette";
import type { WeekdayWeekendStats } from "@/lib/usage-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeekdayWeekendChartProps {
  stats: WeekdayWeekendStats;
  className?: string;
}

interface ChartDatum {
  name: string;
  tokens: number;
  cost: number;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function WdWeTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <p className="mb-1 text-sm font-medium text-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm text-muted-foreground">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span>
            {entry.name === "tokens"
              ? `Avg Tokens: ${formatTokens(entry.value)}`
              : `Avg Cost: ${formatCost(entry.value)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Grouped bar chart comparing average daily token usage and cost
 * on weekdays vs weekends.
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

  const data: ChartDatum[] = [
    {
      name: "Weekday",
      tokens: stats.weekday.avgTokens,
      cost: stats.weekday.avgCost,
    },
    {
      name: "Weekend",
      tokens: stats.weekend.avgTokens,
      cost: stats.weekend.avgCost,
    },
  ];

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
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-xs md:text-sm text-muted-foreground">
          Weekday vs Weekend
        </p>
        {ratioLabel && (
          <p className="text-xs text-muted-foreground">{ratioLabel}</p>
        )}
      </div>

      <div className="h-[180px] w-full">
        <DashboardResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={4} barCategoryGap="30%">
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartMuted}
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: chartAxis }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="tokens"
              tick={{ fontSize: 11, fill: chartAxis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatTokens(v)}
              width={50}
            />
            <YAxis
              yAxisId="cost"
              orientation="right"
              tick={{ fontSize: 11, fill: chartAxis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatCost(v)}
              width={50}
            />
            <Tooltip content={<WdWeTooltip />} cursor={false} />
            <Bar
              yAxisId="tokens"
              dataKey="tokens"
              name="tokens"
              fill={chart.teal}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              yAxisId="cost"
              dataKey="cost"
              name="cost"
              fill={chart.sky}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </DashboardResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-center gap-6">
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-2 rounded-full"
            style={{ background: chart.teal }}
          />
          <span className="text-xs text-muted-foreground">Avg Tokens</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-2 rounded-full"
            style={{ background: chart.sky }}
          />
          <span className="text-xs text-muted-foreground">Avg Cost</span>
        </div>
      </div>
    </div>
  );
}

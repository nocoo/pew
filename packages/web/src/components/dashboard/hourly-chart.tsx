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
import { chart, chartAxis, chartMuted } from "@/lib/palette";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import type { HourlyWeekdayWeekendPoint } from "@/lib/usage-helpers";
import { Clock } from "lucide-react";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HourlyChartProps {
  data: HourlyWeekdayWeekendPoint[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format hour (0-23) to display format ("12am", "1pm", etc.) */
function fmtHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function HourlyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;

  const hourRange = label !== undefined
    ? `${fmtHour(label)} - ${fmtHour((label + 1) % 24)}`
    : "";

  return (
    <ChartTooltip title={hourRange}>
      {payload.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={entry.dataKey === "weekday" ? "Weekday" : "Weekend"}
          value={formatTokens(entry.value)}
          tabularNums
        />
      ))}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Vertical bar chart showing hourly token usage split by weekday vs weekend.
 * Each hour shows two bars side by side: weekday average and weekend average.
 */
export function HourlyChart({ data, className }: HourlyChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No hourly data yet
      </div>
    );
  }

  // Check if there's any data
  const hasData = data.some((d) => d.weekday > 0 || d.weekend > 0);
  if (!hasData) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No hourly data yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-card bg-secondary p-4 md:p-5 flex flex-col",
        className
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-xs md:text-sm text-muted-foreground">
            Hourly Usage
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: chart.violet }}
            />
            <span className="text-xs text-muted-foreground">Weekday</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: chartMuted, opacity: 0.6 }}
            />
            <span className="text-xs text-muted-foreground">Weekend</span>
          </div>
        </div>
      </div>

      {/* Chart fills remaining height */}
      <div className="flex-1 min-h-0">
        <DashboardResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartAxis}
              strokeOpacity={0.15}
              vertical={false}
            />
            <XAxis
              dataKey="hour"
              tickFormatter={fmtHour}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={2}
            />
            <YAxis
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<HourlyTooltip />} isAnimationActive={false} />
            <Bar
              dataKey="weekday"
              fill={chart.violet}
              radius={[2, 2, 0, 0]}
              maxBarSize={12}
            />
            <Bar
              dataKey="weekend"
              fill={chartMuted}
              fillOpacity={0.6}
              radius={[2, 2, 0, 0]}
              maxBarSize={12}
            />
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

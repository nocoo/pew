"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { chart, chartAxis, CHART_COLORS, chartMuted } from "@/lib/palette";
import type { DailyPoint } from "@/hooks/use-usage-data";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// Safe color references (CHART_COLORS is guaranteed 8 elements)
const colorOutput = CHART_COLORS[1] as string;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UsageTrendChartProps {
  data: DailyPoint[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format date string "2026-03-07" to "Mar 7" */
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function UsageTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labels: Record<string, string> = {
    input: "Input",
    output: "Output",
    cached: "Cached",
  };

  const total = payload.reduce((sum, e) => sum + e.value, 0);
  const orderedKeys = ["input", "output", "cached"] as const;

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {orderedKeys.map((key) => {
        const entry = payload.find((e) => e.dataKey === key);
        if (!entry) return null;
        return (
          <ChartTooltipRow
            key={entry.dataKey}
            color={entry.color}
            label={labels[entry.dataKey] ?? entry.dataKey}
            value={formatTokens(entry.value)}
          />
        );
      })}
      <ChartTooltipSummary label="Total" value={formatTokens(total)} />
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Stacked area chart showing daily token usage breakdown:
 * input (non-cached), output, cached.
 */
export function UsageTrendChart({ data, className }: UsageTrendChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No usage data yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-muted-foreground">
            Daily Usage
          </p>
        </div>
        <div className="flex items-center gap-4">
          {[
            { key: "input", label: "Input", color: chart.violet },
            { key: "output", label: "Output", color: colorOutput },
            { key: "cached", label: "Cached", color: chartMuted },
          ].map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradUsageInput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.violet} stopOpacity={0.3} />
                <stop offset="100%" stopColor={chart.violet} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradUsageOutput" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={colorOutput}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={colorOutput}
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id="gradUsageCached" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={chartMuted}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={chartMuted}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartAxis}
              strokeOpacity={0.15}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<UsageTrendTooltip />} isAnimationActive={false} />
            <Area
              type="monotone"
              dataKey="input"
              stackId="1"
              stroke={chart.violet}
              strokeWidth={2}
              fill="url(#gradUsageInput)"
            />
            <Area
              type="monotone"
              dataKey="output"
              stackId="1"
              stroke={colorOutput}
              strokeWidth={2}
              fill="url(#gradUsageOutput)"
            />
            <Area
              type="monotone"
              dataKey="cached"
              stackId="1"
              stroke={chartMuted}
              strokeWidth={2}
              fill="url(#gradUsageCached)"
            />
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

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
import { chart, chartAxis, CHART_COLORS } from "@/lib/palette";
import type { DailyPoint } from "@/hooks/use-usage-data";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";

// Safe color references (CHART_COLORS is guaranteed 8 elements)
const colorOutput = CHART_COLORS[1]!;
const colorCached = CHART_COLORS[2]!;

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

function ChartTooltip({
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

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <p className="mb-1.5 text-xs font-medium text-foreground">
        {label ? fmtDate(label) : ""}
      </p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">
            {labels[entry.dataKey] ?? entry.dataKey}
          </span>
          <span className="ml-auto font-medium text-foreground">
            {formatTokens(entry.value)}
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
            { key: "input", label: "Input", color: chart.teal },
            { key: "output", label: "Output", color: colorOutput },
            { key: "cached", label: "Cached", color: colorCached },
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
              <linearGradient id="gradInput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.teal} stopOpacity={0.3} />
                <stop offset="100%" stopColor={chart.teal} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradOutput" x1="0" y1="0" x2="0" y2="1">
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
              <linearGradient id="gradCached" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={colorCached}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={colorCached}
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
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="input"
              stackId="1"
              stroke={chart.teal}
              strokeWidth={2}
              fill="url(#gradInput)"
            />
            <Area
              type="monotone"
              dataKey="output"
              stackId="1"
              stroke={colorOutput}
              strokeWidth={2}
              fill="url(#gradOutput)"
            />
            <Area
              type="monotone"
              dataKey="cached"
              stackId="1"
              stroke={colorCached}
              strokeWidth={2}
              fill="url(#gradCached)"
            />
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

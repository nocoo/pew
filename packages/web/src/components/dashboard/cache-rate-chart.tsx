"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { chart, chartAxis } from "@/lib/palette";
import type { DailyCacheRate } from "@/lib/cost-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheRateChartProps {
  data: DailyCacheRate[];
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

/** Compute the period-average cache rate across all data points. */
function computeAverage(data: DailyCacheRate[]): number {
  const totalCached = data.reduce((sum, d) => sum + d.cachedTokens, 0);
  const totalInput = data.reduce((sum, d) => sum + d.inputTokens, 0);
  if (totalInput === 0) return 0;
  return (totalCached / totalInput) * 100;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function CacheRateTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: DailyCacheRate }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <p className="mb-1 text-xs font-medium text-foreground">
        {label ? fmtDate(label) : ""}
      </p>
      <p className="text-sm font-semibold text-foreground">
        {point.cacheRate.toFixed(1)}%
      </p>
      <p className="text-xs text-muted-foreground">
        {formatTokens(point.cachedTokens)} cached / {formatTokens(point.inputTokens)} input
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Line chart showing daily cache hit rate (%) with a horizontal reference
 * line at the period average.
 */
export function CacheRateChart({ data, className }: CacheRateChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No cache data yet
      </div>
    );
  }

  const average = computeAverage(data);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-muted-foreground">
            Cache Hit Rate
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div
            className="h-0.5 w-4"
            style={{
              backgroundColor: chart.jade,
              opacity: 0.5,
              borderTop: `1px dashed ${chart.jade}`,
            }}
          />
          <span>Avg {average.toFixed(1)}%</span>
        </div>
      </div>

      <div className="h-[200px] md:h-[240px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
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
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <ReferenceLine
              y={average}
              stroke={chart.jade}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            <Tooltip content={<CacheRateTooltip />} />
            <Line
              type="monotone"
              dataKey="cacheRate"
              stroke={chart.jade}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: chart.jade }}
            />
          </LineChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

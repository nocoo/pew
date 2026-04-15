"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn, formatTokens } from "@/lib/utils";
import { chartAxis } from "@/lib/palette";
import { agentColor } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
import type { SourceTrendPoint } from "@/lib/usage-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceAreaChartProps {
  data: SourceTrendPoint[];
  /** Optional: pad data to include all dates up to this date (YYYY-MM-DD) */
  padToDate?: string;
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

/** Stable gradient ID from source name (CSS-safe). */
function gradId(source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i++) h = ((h << 5) - h + source.charCodeAt(i)) | 0;
  return `gradSource${Math.abs(h)}`;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function SourceAreaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {sorted.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={sourceLabel(entry.dataKey)}
          value={formatTokens(entry.value)}
        />
      ))}
      <ChartTooltipSummary label="Total" value={formatTokens(total)} />
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Stacked area chart showing daily token usage by source/agent.
 * Used in Daily Usage page for monthly view.
 */
export function SourceAreaChart({
  data,
  padToDate,
  className,
}: SourceAreaChartProps) {
  // Extract unique source keys from first data point (all points have same keys due to zero-fill)
  const sourceKeys = useMemo(() => {
    if (!data.length) return [];
    return Object.keys((data[0] as (typeof data)[number]).sources);
  }, [data]);

  // Stacked render order: low-total sources first, high-total sources last.
  // This avoids zero/low sources drawing the top boundary and appearing dominant.
  const sourceRenderKeys = useMemo(() => {
    if (!sourceKeys.length) return [];
    const totals = new Map(sourceKeys.map((key) => [key, 0]));

    for (const point of data) {
      for (const key of sourceKeys) {
        totals.set(key, (totals.get(key) ?? 0) + (point.sources[key] ?? 0));
      }
    }

    return [...sourceKeys].sort((a, b) => {
      const diff = (totals.get(a) ?? 0) - (totals.get(b) ?? 0);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });
  }, [data, sourceKeys]);

  // Pad data to end of month if padToDate is provided
  const chartData = useMemo(() => {
    const raw = data.map((pt) => ({
      date: pt.date,
      ...pt.sources,
    }));

    if (!padToDate || !raw.length) return raw;

    const byDate = new Map(raw.map((d) => [d.date, d]));
    const result: typeof raw = [];

    // Parse first and last dates
    const firstDate = raw[0]?.date;
    if (!firstDate) return raw;

    const startDate = new Date(firstDate + "T00:00:00Z");
    const endDate = new Date(padToDate + "T00:00:00Z");

    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const existing = byDate.get(dateStr);
      if (existing) {
        result.push(existing);
      } else {
        // Zero-fill for missing dates
        const emptyPoint: Record<string, string | number> = { date: dateStr };
        for (const key of sourceKeys) {
          emptyPoint[key] = 0;
        }
        result.push(emptyPoint as typeof raw[number]);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return result;
  }, [data, padToDate, sourceKeys]);

  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No agent data yet
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs md:text-sm text-muted-foreground">By Agent</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {sourceKeys.map((source) => (
            <div key={source} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: agentColor(source).color }}
              />
              <span className="text-xs text-muted-foreground">
                {sourceLabel(source)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[200px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <defs>
              {sourceRenderKeys.map((source) => (
                <linearGradient
                  key={source}
                  id={gradId(source)}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={agentColor(source).color}
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="100%"
                    stopColor={agentColor(source).color}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              ))}
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
            <Tooltip content={<SourceAreaTooltip />} isAnimationActive={false} />
            {sourceRenderKeys.map((source) => (
              <Area
                key={source}
                type="monotone"
                dataKey={source}
                stackId="1"
                stroke={agentColor(source).color}
                strokeWidth={1.5}
                fill={`url(#${gradId(source)})`}
              />
            ))}
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
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
import { nextHiddenLegendKeys } from "@/lib/chart-legend-filter";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceTrendChartProps {
  data: SourceTrendPoint[];
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

/** Format Y-axis tokens: 0, 10K, 1.2M */
function fmtAxisTokens(value: number): string {
  if (value === 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function SourceTrendTooltip({
  active,
  payload,
  label,
  hiddenSources,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  hiddenSources: Set<string>;
}) {
  if (!active || !payload?.length) return null;

  const visible = payload.filter((e) => !hiddenSources.has(e.dataKey));
  if (!visible.length) return null;

  const total = visible.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {visible.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={sourceLabel(entry.dataKey)}
          value={formatTokens(entry.value)}
        />
      ))}
      {visible.length > 1 && (
        <ChartTooltipSummary label="Total" value={formatTokens(total)} />
      )}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Line chart showing token usage per source (tool) over time.
 * Each source gets a distinct colored line.
 * Click legend to isolate, cmd/ctrl+click legend to toggle visibility.
 */
export function SourceTrendChart({ data, className }: SourceTrendChartProps) {
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set());

  // Extract unique source keys from first data point (all points have same keys due to zero-fill)
  const sourceKeys = useMemo(() => {
    if (!data.length) return [];
    return Object.keys((data[0] as (typeof data)[number]).sources);
  }, [data]);

  // Build flat data for Recharts: [{ date, "claude-code": N, "gemini-cli": N, ... }]
  const chartData = useMemo(
    () =>
      data.map((pt) => ({
        date: pt.date,
        ...pt.sources,
      })),
    [data]
  );

  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No source data yet
      </div>
    );
  }

  function handleLegendClick(source: string, metaKey: boolean) {
    setHiddenSources((prev) => {
      return nextHiddenLegendKeys({
        keys: sourceKeys,
        hiddenKeys: prev,
        targetKey: source,
        metaKey,
      });
    });
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
            Tool Usage Trend
          </p>
        </div>
        <div className="flex items-center gap-4">
          {sourceKeys.map((source) => {
            const isHidden = hiddenSources.has(source);
            return (
              <button
                key={source}
                type="button"
                onClick={(event) =>
                  handleLegendClick(source, event.metaKey || event.ctrlKey)
                }
                className={cn(
                  "flex items-center gap-1.5 transition-opacity",
                  isHidden && "opacity-40"
                )}
              >
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ background: agentColor(source).color }}
                />
                <span className="text-xs text-muted-foreground">
                  {sourceLabel(source)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
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
              tickFormatter={fmtAxisTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              content={<SourceTrendTooltip hiddenSources={hiddenSources} />}
              isAnimationActive={false}
            />
            {sourceKeys.map((source) => (
              <Line
                key={source}
                type="monotone"
                dataKey={source}
                stroke={agentColor(source).color}
                strokeWidth={2}
                dot={false}
                hide={hiddenSources.has(source)}
              />
            ))}
          </LineChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

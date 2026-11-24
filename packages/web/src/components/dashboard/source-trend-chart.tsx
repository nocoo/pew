"use client";

import { CHART_ANIMATION } from "@/lib/chart-animation";
import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { cn, formatTokens } from "@/lib/utils";
import { Button } from "@nocoo/basalt/components/button";
import { chartAxis } from "@/lib/palette";
import { agentColor } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
import type { SourceTrendPoint } from "@/lib/usage-helpers";
import { nextHiddenLegendKeys } from "@/lib/chart-legend-filter";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartSeriesTooltip } from "./chart-series-tooltip";
import { ChartLegendMore } from "./chart-legend-more";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceTrendChartProps {
  data: SourceTrendPoint[];
  className?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format date string "2026-03-07" to "Mar 7" */
function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

  return (
    <ChartSeriesTooltip
      title={label ? fmtDate(label) : undefined}
      entries={payload
        .filter((e) => !hiddenSources.has(e.dataKey))
        .map((entry) => ({ ...entry, name: sourceLabel(entry.dataKey) }))}
    />
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
export function SourceTrendChart({
  data,
  className,
  title = "Tool Usage Trend",
}: SourceTrendChartProps) {
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
    [data],
  );

  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-basalt-secondary ring-1 ring-basalt-border/80 shadow-basalt-card p-8 text-sm text-basalt-muted-foreground",
          className,
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
    <figure
      aria-label={title}
      className={cn(
        "min-w-0 rounded-card bg-basalt-secondary ring-1 ring-basalt-border/80 shadow-basalt-card p-4 md:p-5",
        className,
      )}
    >
      <p className="mb-3 text-xs md:text-sm text-basalt-muted-foreground">{title}</p>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {sourceKeys.slice(0, 5).map((source) => {
          const isHidden = hiddenSources.has(source);
          return (
            <Button
              key={source}
              type="button"
              variant="ghost"
              aria-pressed={!isHidden}
              onClick={(event) => handleLegendClick(source, event.metaKey || event.ctrlKey)}
              className={cn(
                "h-auto min-w-0 gap-1.5 p-0 text-xs font-normal transition-opacity",
                isHidden && "opacity-40",
              )}
            >
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: agentColor(source).color }}
              />
              <span className="max-w-[160px] truncate text-xs text-basalt-muted-foreground">
                {sourceLabel(source)}
              </span>
            </Button>
          );
        })}
        <ChartLegendMore
          items={sourceKeys.map((source) => ({
            key: source,
            label: sourceLabel(source),
            color: agentColor(source).color,
          }))}
          hiddenKeys={hiddenSources}
          onSelect={handleLegendClick}
        />
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
              width={52}
            />
            <Tooltip
              content={<SourceTrendTooltip hiddenSources={hiddenSources} />}
              isAnimationActive={false}
            />
            {sourceKeys.map((source) => (
              <Line
                {...CHART_ANIMATION}
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
    </figure>
  );
}

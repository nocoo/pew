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
import { modelColor } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
import type { ModelEra } from "@/lib/model-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelAreaChartProps {
  data: ModelEra[];
  /** Optional: pad data to include all dates up to this date (YYYY-MM-DD) */
  padToDate?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable gradient ID from model name (CSS-safe). */
function gradId(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i++) h = ((h << 5) - h + model.charCodeAt(i)) | 0;
  return `gradModelArea${Math.abs(h)}`;
}

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

function ModelAreaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  // Sort by value descending
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {sorted.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={shortModel(entry.dataKey)}
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
 * Stacked area chart showing daily token usage by model.
 * Shows absolute token counts (not percentages).
 * Used in Daily Usage page for monthly view.
 */
export function ModelAreaChart({
  data,
  padToDate,
  className,
}: ModelAreaChartProps) {
  // Extract unique model keys from first data point (all points zero-filled)
  const modelKeys = useMemo(() => {
    if (!data.length) return [];
    return Object.keys((data[0] as (typeof data)[number]).models);
  }, [data]);

  // Convert to flat chart data format and pad to end of month
  const chartData = useMemo(() => {
    const raw = data.map((pt) => ({
      date: pt.date,
      ...pt.models,
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
        for (const key of modelKeys) {
          emptyPoint[key] = 0;
        }
        result.push(emptyPoint as typeof raw[number]);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return result;
  }, [data, padToDate, modelKeys]);

  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No model data yet
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
        <p className="text-xs md:text-sm text-muted-foreground">By Model</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {modelKeys.slice(0, 5).map((model) => (
            <div key={model} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{
                  background: modelColor(model).color,
                }}
              />
              <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                {shortModel(model)}
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
              {modelKeys.map((model) => (
                <linearGradient
                  key={model}
                  id={gradId(model)}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={modelColor(model).color}
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="100%"
                    stopColor={modelColor(model).color}
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
            <Tooltip content={<ModelAreaTooltip />} isAnimationActive={false} />
            {modelKeys.map((model) => (
              <Area
                key={model}
                type="monotone"
                dataKey={model}
                stackId="1"
                stroke={modelColor(model).color}
                strokeWidth={1.5}
                fill={`url(#${gradId(model)})`}
              />
            ))}
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

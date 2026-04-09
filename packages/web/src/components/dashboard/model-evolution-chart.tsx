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
import { cn } from "@/lib/utils";
import { chartAxis } from "@/lib/palette";
import { modelColor } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
import type { ModelEra } from "@/lib/model-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelEvolutionChartProps {
  data: ModelEra[];
  className?: string;
}

/** Flat row for Recharts — one key per model holding its percentage. */
interface ChartRow {
  date: string;
  [model: string]: string | number; // date is string, rest are percentages
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable gradient ID from model name (CSS-safe). */
function gradId(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i++) h = ((h << 5) - h + model.charCodeAt(i)) | 0;
  return `gradModel${Math.abs(h)}`;
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

/** Format Y-axis percentage: 0%, 50%, 100% */
function fmtPct(value: number): string {
  return `${Math.round(value)}%`;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ModelEvolutionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  // Reverse to show top model first (matches visual stacking)
  const items = [...payload].reverse();

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {items.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={shortModel(entry.dataKey)}
          value={`${entry.value.toFixed(1)}%`}
        />
      ))}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 100% stacked area chart showing model usage share over time.
 * Each model is a band; the total always sums to 100%.
 */
export function ModelEvolutionChart({
  data,
  className,
}: ModelEvolutionChartProps) {
  // Extract unique model keys from first data point (all points zero-filled)
  const modelKeys = useMemo(() => {
    if (!data.length) return [];
    return Object.keys((data[0] as (typeof data)[number]).models);
  }, [data]);

  // Convert absolute counts to percentages for 100% stacking
  const chartData: ChartRow[] = useMemo(
    () =>
      data.map((pt) => {
        const total = Object.values(pt.models).reduce((s, v) => s + v, 0);
        const row: ChartRow = { date: pt.date };
        for (const model of modelKeys) {
          row[model] = total > 0 ? ((pt.models[model] ?? 0) / total) * 100 : 0;
        }
        return row;
      }),
    [data, modelKeys]
  );

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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-muted-foreground">
            Model Evolution
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {modelKeys.map((model) => (
            <div key={model} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{
                  background: modelColor(model).color,
                }}
              />
              <span className="text-xs text-muted-foreground">
                {shortModel(model)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            stackOffset="none"
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
                    stopOpacity={0.6}
                  />
                  <stop
                    offset="100%"
                    stopColor={modelColor(model).color}
                    stopOpacity={0.2}
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
              tickFormatter={fmtPct}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={[0, 100]}
            />
            <Tooltip
              content={<ModelEvolutionTooltip />}
              isAnimationActive={false}
            />
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

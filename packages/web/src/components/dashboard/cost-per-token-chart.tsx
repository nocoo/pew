"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/pricing";
import { chartAxis, chartPositive, chartNegative, CHART_COLORS } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
import { sourceLabel } from "@/hooks/use-usage-data";
import type { ModelCostEfficiency } from "@/lib/cost-helpers";

// Color scale: green (cheap) → amber (mid) → red (expensive)
const colorCheap = chartPositive;
const colorMid = CHART_COLORS[5]!; // amber
const colorExpensive = chartNegative;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostPerTokenChartProps {
  data: ModelCostEfficiency[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate bar color based on relative cost position within the dataset.
 * 0 = cheapest (green), 1 = most expensive (red).
 */
function costColor(ratio: number): string {
  if (ratio < 0.5) return colorCheap;
  if (ratio < 0.75) return colorMid;
  return colorExpensive;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function CostPerTokenTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    payload?: {
      model: string;
      source: string;
      totalCost: number;
      totalTokens: number;
      costPer1K: number;
      label: string;
      sourceLabel: string;
    };
  }>;
}) {
  if (!active || !payload?.length) return null;

  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <p className="mb-0.5 text-xs font-medium text-foreground">{d.model}</p>
      <p className="mb-1.5 text-xs text-muted-foreground">{d.sourceLabel}</p>
      <div className="space-y-0.5 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Cost/1K tokens</span>
          <span className="font-medium text-foreground">
            {formatCost(d.costPer1K)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Total cost</span>
          <span className="font-medium text-foreground">
            {formatCost(d.totalCost)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Total tokens</span>
          <span className="font-medium text-foreground">
            {d.totalTokens.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Horizontal bar chart comparing effective cost-per-1K-tokens across models.
 * Top 10 models by total tokens, sorted by costPer1K descending.
 * Bar color intensity reflects cost: green=cheap, amber=mid, red=expensive.
 */
export function CostPerTokenChart({
  data,
  className,
}: CostPerTokenChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No cost-per-token data yet
      </div>
    );
  }

  // Already sorted by costPer1K descending from computeCostPerToken
  const top = data.slice(0, 10);

  // Compute min/max for color interpolation
  const maxCost = top[0]?.costPer1K ?? 0;
  const minCost = top[top.length - 1]?.costPer1K ?? 0;
  const range = maxCost - minCost;

  const chartData = [...top].reverse().map((m) => ({
    ...m,
    label: shortModel(m.model),
    sourceLabel: sourceLabel(m.source),
  }));

  const barHeight = 32;
  const chartHeight = Math.max(chartData.length * barHeight + 40, 160);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4">
        <p className="text-xs md:text-sm text-muted-foreground">
          Cost per 1K Tokens
        </p>
      </div>

      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartAxis}
              strokeOpacity={0.15}
              horizontal={false}
            />
            <XAxis
              type="number"
              tickFormatter={(v: number) => formatCost(v)}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={140}
            />
            <Tooltip content={<CostPerTokenTooltip />} />
            <Bar dataKey="costPer1K" radius={[0, 4, 4, 0]}>
              {chartData.map((entry) => {
                const ratio =
                  range > 0
                    ? (entry.costPer1K - minCost) / range
                    : 0;
                return (
                  <Cell
                    key={entry.model}
                    fill={costColor(ratio)}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

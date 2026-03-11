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
import { chart, chartAxis, CHART_COLORS } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
import type { ModelAggregate } from "@/hooks/use-usage-data";
import { sourceLabel } from "@/hooks/use-usage-data";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";

// Safe color references
const colorOutput = CHART_COLORS[1]!;
const colorCached = CHART_COLORS[2]!;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelBreakdownChartProps {
  data: ModelAggregate[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ModelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
    payload?: { model: string; sourceLabel: string; total: number };
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labels: Record<string, string> = {
    input: "Input",
    output: "Output",
    cached: "Cached",
  };

  const modelData = payload[0]?.payload;

  return (
    <div className="rounded-[var(--radius-widget)] border border-border bg-card p-2.5 shadow-sm">
      <p className="mb-0.5 text-xs font-medium text-foreground">
        {label}
      </p>
      {modelData && (
        <p className="mb-1.5 text-xs text-muted-foreground">
          {modelData.sourceLabel} &middot; {formatTokens(modelData.total)} total
        </p>
      )}
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
 * Horizontal stacked bar chart showing token breakdown by model.
 * Top 10 models by total token count.
 */
export function ModelBreakdownChart({
  data,
  className,
}: ModelBreakdownChartProps) {
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

  // Show top 10 models
  const top = data.slice(0, 10).map((m) => ({
    ...m,
    name: shortModel(m.model),
    sourceLabel: sourceLabel(m.source),
  }));

  // Reverse for horizontal bar (top item at top)
  const chartData = [...top].reverse();

  const barHeight = 32;
  const chartHeight = Math.max(chartData.length * barHeight + 40, 160);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          By Model
        </p>
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

      <div style={{ height: chartHeight }}>
        <DashboardResponsiveContainer width="100%" height="100%">
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
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={140}
            />
            <Tooltip content={<ModelTooltip />} />
            <Bar
              dataKey="input"
              stackId="1"
              fill={chart.teal}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="output"
              stackId="1"
              fill={colorOutput}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="cached"
              stackId="1"
              fill={colorCached}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

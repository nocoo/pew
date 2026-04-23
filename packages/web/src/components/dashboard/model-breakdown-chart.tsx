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
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
  ChartTooltipSubtitle,
} from "./chart-tooltip";

// Safe color references
const colorOutput = CHART_COLORS[1] as string;
const colorCached = CHART_COLORS[2] as string;

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

function ModelBreakdownTooltip({
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
  const total = modelData?.total ?? 0;
  const orderedKeys = ["input", "output", "cached"] as const;

  return (
    <ChartTooltip title={label}>
      {modelData && (
        <ChartTooltipSubtitle>
          {modelData.sourceLabel}
        </ChartTooltipSubtitle>
      )}
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
 * Horizontal stacked bar chart showing token breakdown by model.
 * Top 10 models by total token count.
 *
 * ModelAggregate rows are keyed by source:model, so the same model used in
 * multiple sources (e.g. GLM-4.7 via OpenCode + Gemini CLI) produces separate
 * entries.  We merge them here so the chart shows one bar per model.
 */
export function ModelBreakdownChart({
  data,
  className,
}: ModelBreakdownChartProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No model data yet
      </div>
    );
  }

  // Merge entries that share the same model name across different sources
  const merged = new Map<
    string,
    { model: string; sources: string[]; input: number; output: number; cached: number; total: number }
  >();
  for (const m of data) {
    const existing = merged.get(m.model);
    if (existing) {
      existing.input += m.input;
      existing.output += m.output;
      existing.cached += m.cached;
      existing.total += m.total;
      if (!existing.sources.includes(m.source)) {
        existing.sources.push(m.source);
      }
    } else {
      merged.set(m.model, {
        model: m.model,
        sources: [m.source],
        input: m.input,
        output: m.output,
        cached: m.cached,
        total: m.total,
      });
    }
  }

  // Sort by total descending, take top 10
  const top = Array.from(merged.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((m) => ({
      ...m,
      name: shortModel(m.model),
      sourceLabel: m.sources.map(sourceLabel).join(", "),
    }));

  // Reverse for horizontal bar (top item at top)
  const chartData = [...top].reverse();

  const barHeight = 32;
  const chartHeight = Math.max(chartData.length * barHeight + 40, 160);

  return (
    <div
      className={cn(
        "rounded-card bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          By Model
        </p>
        <div className="flex items-center gap-4">
          {[
            { key: "input", label: "Input", color: chart.violet },
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
            <Tooltip content={<ModelBreakdownTooltip />} isAnimationActive={false} />
            <Bar
              dataKey="input"
              stackId="1"
              fill={chart.violet}
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

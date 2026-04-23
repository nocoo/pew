"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { UsageRow } from "@/hooks/use-usage-data";
import { cn, formatTokens } from "@/lib/utils";
import { chartAxis, modelColor } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineModelChartProps {
  records: UsageRow[];
  tzOffset: number;
  fromISO: string;
  toISO: string;
  /** Max number of models to show (rest grouped as "Other") */
  topN?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a local-adjusted Date into the slot label "Mar 12 09:00". */
function formatSlotLabel(d: Date): string {
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day} ${hh}:${mm}`;
}

/** Format slot label for X axis: show time only, include date at midnight */
function fmtSlot(slot: string): string {
  const parts = slot.split(" ");
  const time = parts[2] ?? slot;
  if (time === "00:00") return `${parts[0]} ${parts[1]}`;
  return time;
}

/** Format slot for tooltip */
function fmtSlotFull(slot: string): string {
  const parts = slot.split(" ");
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1]}, ${parts[2]}`;
  }
  return slot;
}

// ---------------------------------------------------------------------------
// Data transformation
// ---------------------------------------------------------------------------

interface ModelSlotPoint {
  slot: string;
  hourStart: string;
  [model: string]: string | number;
}

function toModelTimeline(
  records: UsageRow[],
  tzOffset: number,
  fromISO: string,
  toISO: string,
  topN: number
): { data: ModelSlotPoint[]; modelKeys: string[] } {
  const SLOT_MS = 30 * 60_000;

  // Sum tokens by model to find top N
  const modelTotals = new Map<string, number>();
  for (const r of records) {
    modelTotals.set(r.model, (modelTotals.get(r.model) ?? 0) + r.total_tokens);
  }
  const sortedModels = Array.from(modelTotals.entries())
    .sort((a, b) => b[1] - a[1]);

  const topModels = sortedModels.slice(0, topN).map(([m]) => m);
  const hasOther = sortedModels.length > topN;
  const modelKeys = hasOther ? [...topModels, "Other"] : topModels;

  // Aggregate by slot
  const bySlot = new Map<number, Record<string, number>>();
  for (const r of records) {
    const ms = new Date(r.hour_start).getTime();
    const key = ms - (ms % SLOT_MS);

    let bucket = bySlot.get(key);
    if (!bucket) {
      bucket = {};
      for (const m of modelKeys) bucket[m] = 0;
      bySlot.set(key, bucket);
    }

    const modelKey = topModels.includes(r.model) ? r.model : "Other";
    bucket[modelKey] = (bucket[modelKey] ?? 0) + r.total_tokens;
  }

  // Generate all slots in range
  const startMs = new Date(fromISO).getTime();
  const endMs = new Date(toISO).getTime();
  let cursor = startMs - (startMs % SLOT_MS);
  const result: ModelSlotPoint[] = [];

  while (cursor <= endMs) {
    const localDate = new Date(cursor - tzOffset * 60_000);
    const slot = formatSlotLabel(localDate);
    const hourStart = new Date(cursor).toISOString();
    const vals = bySlot.get(cursor) ?? {};

    const point: ModelSlotPoint = { slot, hourStart };
    for (const m of modelKeys) {
      point[m] = vals[m] ?? 0;
    }
    result.push(point);
    cursor += SLOT_MS;
  }

  return { data: result, modelKeys };
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
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtSlotFull(label) : undefined}>
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
 * Timeline bar chart showing tokens by model over 72 hours.
 */
export function TimelineModelChart({
  records,
  tzOffset,
  fromISO,
  toISO,
  topN = 5,
  className,
}: TimelineModelChartProps) {
  const { data, modelKeys } = toModelTimeline(records, tzOffset, fromISO, toISO, topN);

  if (!data.length || modelKeys.length === 0) {
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

  const tickInterval = Math.max(1, Math.floor(data.length / 12));

  const legendItems = modelKeys.slice(0, 6).map((model) => ({
    key: model,
    label: shortModel(model),
    color: modelColor(model).color,
  }));

  return (
    <div
      className={cn(
        "rounded-card bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs md:text-sm text-muted-foreground">By Model</p>
        <div className="flex flex-wrap items-center gap-4">
          {legendItems.map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[200px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <BarChart
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
              dataKey="slot"
              tickFormatter={fmtSlot}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tickFormatter={formatTokens}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<ModelTooltip />} isAnimationActive={false} />
            {modelKeys.map((model, i) => (
              <Bar
                key={model}
                dataKey={model}
                stackId="1"
                fill={modelColor(model).color}
                radius={
                  i === modelKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]
                }
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

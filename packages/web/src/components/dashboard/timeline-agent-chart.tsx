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
import { chartAxis, agentColor } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineAgentChartProps {
  records: UsageRow[];
  tzOffset: number;
  fromISO: string;
  toISO: string;
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

interface AgentSlotPoint {
  slot: string;
  hourStart: string;
  [source: string]: string | number;
}

function toAgentTimeline(
  records: UsageRow[],
  tzOffset: number,
  fromISO: string,
  toISO: string
): { data: AgentSlotPoint[]; sourceKeys: string[] } {
  const SLOT_MS = 30 * 60_000;

  // Collect all sources
  const allSources = new Set<string>();
  for (const r of records) {
    allSources.add(r.source);
  }
  const sourceKeys = Array.from(allSources).sort();

  // Aggregate by slot and source
  const bySlot = new Map<number, Record<string, number>>();
  for (const r of records) {
    const ms = new Date(r.hour_start).getTime();
    const key = ms - (ms % SLOT_MS);

    let bucket = bySlot.get(key);
    if (!bucket) {
      bucket = {};
      for (const s of sourceKeys) bucket[s] = 0;
      bySlot.set(key, bucket);
    }
    bucket[r.source] = (bucket[r.source] ?? 0) + r.total_tokens;
  }

  // Generate all slots in range
  const startMs = new Date(fromISO).getTime();
  const endMs = new Date(toISO).getTime();
  let cursor = startMs - (startMs % SLOT_MS);
  const result: AgentSlotPoint[] = [];

  while (cursor <= endMs) {
    const localDate = new Date(cursor - tzOffset * 60_000);
    const slot = formatSlotLabel(localDate);
    const hourStart = new Date(cursor).toISOString();
    const vals = bySlot.get(cursor) ?? {};

    const point: AgentSlotPoint = { slot, hourStart };
    for (const s of sourceKeys) {
      point[s] = vals[s] ?? 0;
    }
    result.push(point);
    cursor += SLOT_MS;
  }

  return { data: result, sourceKeys };
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function AgentTooltip({
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
 * Timeline bar chart showing tokens by agent/source over 72 hours.
 */
export function TimelineAgentChart({
  records,
  tzOffset,
  fromISO,
  toISO,
  className,
}: TimelineAgentChartProps) {
  const { data, sourceKeys } = toAgentTimeline(records, tzOffset, fromISO, toISO);

  if (!data.length || sourceKeys.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No agent data yet
      </div>
    );
  }

  const tickInterval = Math.max(1, Math.floor(data.length / 12));

  const legendItems = sourceKeys.map((source) => ({
    key: source,
    label: sourceLabel(source),
    color: agentColor(source).color,
  }));

  return (
    <div
      className={cn(
        "rounded-card bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs md:text-sm text-muted-foreground">By Agent</p>
        <div className="flex flex-wrap items-center gap-4">
          {legendItems.map(({ key, label, color }) => (
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
            <Tooltip content={<AgentTooltip />} isAnimationActive={false} />
            {sourceKeys.map((source, i) => (
              <Bar
                key={source}
                dataKey={source}
                stackId="1"
                fill={agentColor(source).color}
                radius={
                  i === sourceKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]
                }
              />
            ))}
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

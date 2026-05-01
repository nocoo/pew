"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { SessionRow } from "@/lib/session-helpers";
import { toMessageDailyStats, toMessagesByDimension } from "@/lib/session-helpers";
import type { DeviceTimelinePoint, DeviceAggregate } from "@pew/core";
import { toDeviceTrendPoints, buildDeviceLabelMap } from "@/lib/device-helpers";
import { fillDateRange } from "@/lib/date-helpers";
import { cn, formatTokens } from "@/lib/utils";
import { chartAxis, CHART_COLORS, agentColor, modelColor } from "@/lib/palette";
import { sourceLabel } from "@/hooks/use-usage-data";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartTooltip, ChartTooltipRow, ChartTooltipSummary } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Dimension = "human-agent" | "source" | "model" | "device";

interface DailyActivityChartProps {
  /** Sessions for the selected period (already filtered by date range upstream) */
  sessions: SessionRow[];
  /** Device timeline (daily granularity, same period as `sessions`) */
  deviceTimeline: DeviceTimelinePoint[];
  /** Devices for label resolution */
  devices: DeviceAggregate[];
  /** Local timezone offset in minutes (from getTimezoneOffset()) */
  tzOffset: number;
  /** Local YYYY-MM-DD for "today" — chart fills empty days up to this */
  today: string;
  className?: string;
}

interface ChartSeries {
  /** Stable series key used as recharts dataKey */
  key: string;
  /** Human-readable legend label */
  label: string;
  /** Stroke/fill color */
  color: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: "human-agent", label: "Human / Agent" },
  { value: "source", label: "By Agent" },
  { value: "model", label: "By Model" },
  { value: "device", label: "By Device" },
];

const UNIT_TOKENS = "tokens";
const UNIT_MESSAGES = "messages";

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function ActivityTooltip({
  active,
  payload,
  label,
  unit,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  unit: string;
  series: ChartSeries[];
}) {
  if (!active || !payload?.length) return null;

  const labelByKey = new Map(series.map((s) => [s.key, s.label]));
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + e.value, 0);
  const fmtVal = unit === UNIT_TOKENS ? formatTokens : (v: number) => v.toLocaleString();

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {sorted.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={labelByKey.get(entry.dataKey) ?? entry.dataKey}
          value={`${fmtVal(entry.value)} ${unit}`}
        />
      ))}
      <ChartTooltipSummary label="Total" value={`${fmtVal(total)} ${unit}`} />
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-dimension daily activity chart for the Sessions page.
 *
 * Lets the user switch between four views over the same date range:
 *   1. Human / Agent  — message counts split by sender role (existing default)
 *   2. By Agent       — message counts split by AI agent (source)
 *   3. By Model       — message counts split by model id
 *   4. By Device      — token totals from useDeviceData (sessions don't track
 *                       device, so this dimension uses the token timeline and
 *                       is explicitly labeled as "tokens" rather than messages)
 */
export function DailyActivityChart({
  sessions,
  deviceTimeline,
  devices,
  tzOffset,
  today,
  className,
}: DailyActivityChartProps) {
  const [dim, setDim] = useState<Dimension>("human-agent");

  // Per-dimension data + series prep -----------------------------------------

  const humanAgent = useMemo(() => {
    const sparse = toMessageDailyStats(sessions, tzOffset);
    const filled = fillDateRange(
      sparse,
      "date",
      (d) => ({ date: d, user: 0, assistant: 0 }),
      today,
    );
    const series: ChartSeries[] = [
      { key: "user", label: "Human", color: CHART_COLORS[0] as string },
      { key: "assistant", label: "Agent", color: CHART_COLORS[1] as string },
    ];
    return { data: filled, series, unit: UNIT_MESSAGES };
  }, [sessions, tzOffset, today]);

  const bySource = useMemo(() => {
    const { data, keys } = toMessagesByDimension(sessions, tzOffset, "source");
    const filled = fillDateRange(
      data,
      "date",
      (d) => {
        const empty: Record<string, string | number> = { date: d };
        for (const k of keys) empty[k] = 0;
        return empty;
      },
      today,
    );
    const series: ChartSeries[] = keys.map((k) => ({
      key: k,
      label: sourceLabel(k),
      color: agentColor(k).color,
    }));
    return { data: filled, series, unit: UNIT_MESSAGES };
  }, [sessions, tzOffset, today]);

  const byModel = useMemo(() => {
    const { data, keys } = toMessagesByDimension(sessions, tzOffset, "model");
    const filled = fillDateRange(
      data,
      "date",
      (d) => {
        const empty: Record<string, string | number> = { date: d };
        for (const k of keys) empty[k] = 0;
        return empty;
      },
      today,
    );
    const series: ChartSeries[] = keys.map((k) => ({
      key: k,
      label: k,
      color: modelColor(k).color,
    }));
    return { data: filled, series, unit: UNIT_MESSAGES };
  }, [sessions, tzOffset, today]);

  const byDevice = useMemo(() => {
    const points = toDeviceTrendPoints(deviceTimeline);
    // Determine keys from the first point (toDeviceTrendPoints zero-fills)
    const first = points[0];
    const keys = first
      ? Object.keys(first).filter((k) => k !== "date")
      : [];
    const filled = fillDateRange(
      points,
      "date",
      (d) => {
        const empty: Record<string, string | number> = { date: d };
        for (const k of keys) empty[k] = 0;
        return empty;
      },
      today,
    );
    const labelMap = buildDeviceLabelMap(devices);
    const series: ChartSeries[] = keys.map((k, i) => ({
      key: k,
      label: labelMap.get(k) ?? k,
      color: CHART_COLORS[i % CHART_COLORS.length] as string,
    }));
    return { data: filled, series, unit: UNIT_TOKENS };
  }, [deviceTimeline, devices, today]);

  const view = (() => {
    switch (dim) {
      case "human-agent":
        return humanAgent;
      case "source":
        return bySource;
      case "model":
        return byModel;
      case "device":
        return byDevice;
    }
  })();

  const isEmpty = view.data.length === 0 || view.series.length === 0;

  return (
    <div className={cn("rounded-card bg-secondary p-4 md:p-5", className)}>
      {/* Header: title + segmented control */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <p className="text-xs md:text-sm text-muted-foreground">Daily Activity</p>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {view.unit}
          </span>
        </div>
        <div className="inline-flex rounded-md bg-background p-0.5 text-xs">
          {DIMENSIONS.map((opt) => {
            const active = opt.value === dim;
            return (
              <button
                key={opt.value}
                onClick={() => setDim(opt.value)}
                className={cn(
                  "px-2.5 py-1 rounded-sm transition-colors",
                  active
                    ? "bg-secondary text-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      {!isEmpty && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {view.series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {isEmpty ? (
        <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
          No {dim === "device" ? "device" : "message"} data yet
        </div>
      ) : (
        <div className="h-[240px] md:h-[280px]">
          <DashboardResponsiveContainer width="100%" height="100%">
            <BarChart data={view.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
                tick={{ fill: chartAxis, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={view.unit === UNIT_TOKENS ? 48 : 36}
                {...(view.unit === UNIT_TOKENS ? { tickFormatter: formatTokens } : {})}
              />
              <Tooltip
                content={<ActivityTooltip unit={view.unit} series={view.series} />}
                isAnimationActive={false}
              />
              {view.series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="1"
                  fill={s.color}
                  radius={i === view.series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </DashboardResponsiveContainer>
        </div>
      )}
    </div>
  );
}

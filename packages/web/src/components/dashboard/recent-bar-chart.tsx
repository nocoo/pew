"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { DeviceTimelinePoint, DeviceAggregate } from "@pew/core";
import { cn, formatTokens } from "@/lib/utils";
import { chart, chartAxis, CHART_COLORS } from "@/lib/palette";
import { deviceLabel } from "@/lib/device-helpers";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HalfHourPoint {
  /** Half-hour slot label, e.g. "Mar 12 09:00" */
  slot: string;
  /** Raw hour_start for sorting */
  hourStart: string;
  input: number;
  output: number;
  total: number;
}

export type ViewMode = "in-out" | "devices";

interface RecentBarChartProps {
  data: HalfHourPoint[];
  /** Device timeline data for "devices" view mode */
  deviceTimeline?: DeviceTimelinePoint[] | undefined;
  /** Device info for label lookup */
  devices?: DeviceAggregate[] | undefined;
  /** View mode: "in-out" (input/output) or "devices" (by device) */
  viewMode?: ViewMode | undefined;
  /** Callback when view mode changes */
  onViewModeChange?: ((mode: ViewMode) => void) | undefined;
  className?: string | undefined;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const colorInput = chart.violet;
const colorOutput = CHART_COLORS[1] as string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format slot label for X axis: show time only, include date at midnight */
function fmtSlot(slot: string): string {
  // slot is "Mar 12 09:00" — extract time part
  const parts = slot.split(" ");
  const time = parts[2] ?? slot;
  // Show "Mar 12" alongside midnight ticks for day orientation
  if (time === "00:00") return `${parts[0]} ${parts[1]}`;
  return time;
}

/** Format slot for tooltip: full "Mar 12, 09:00-09:30" */
function fmtSlotFull(slot: string): string {
  const parts = slot.split(" ");
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1]}, ${parts[2]}`;
  }
  return slot;
}

/** Format a half-hour ISO timestamp into slot label "Mar 12 09:00" */
function formatSlotLabel(d: Date, tzOffset: number): string {
  const localDate = new Date(d.getTime() - tzOffset * 60_000);
  const mon = localDate.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = localDate.getUTCDate();
  const hh = String(localDate.getUTCHours()).padStart(2, "0");
  const mm = String(localDate.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day} ${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Custom tooltips
// ---------------------------------------------------------------------------

function InOutTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labels: Record<string, string> = {
    input: "Input",
    output: "Output",
  };

  const total = payload.reduce((sum, e) => sum + e.value, 0);
  const orderedKeys = ["input", "output"] as const;

  return (
    <ChartTooltip title={label ? fmtSlotFull(label) : undefined}>
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

function DevicesTooltip({
  active,
  payload,
  label,
  deviceLabels,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  deviceLabels: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;

  // Sort by value descending
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + e.value, 0);

  return (
    <ChartTooltip title={label ? fmtSlotFull(label) : undefined}>
      {sorted.map((entry) => (
        <ChartTooltipRow
          key={entry.dataKey}
          color={entry.color}
          label={deviceLabels.get(entry.dataKey) ?? entry.dataKey.slice(0, 8)}
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

export function RecentBarChart({
  data,
  deviceTimeline,
  devices,
  viewMode = "devices",
  onViewModeChange,
  className,
}: RecentBarChartProps) {
  // Build device label map
  const deviceLabels = new Map<string, string>();
  for (const d of devices ?? []) {
    deviceLabels.set(d.device_id, deviceLabel(d));
  }

  // Transform device timeline to chart data format
  const deviceChartData = (() => {
    if (!deviceTimeline?.length) return [];

    const tzOffset = new Date().getTimezoneOffset();
    const SLOT_MS = 30 * 60_000;

    // Group by slot
    const bySlot = new Map<
      number,
      { slot: string; hourStart: string; [deviceId: string]: string | number }
    >();

    // Get all unique device IDs
    const deviceIds = new Set<string>();
    for (const row of deviceTimeline) {
      deviceIds.add(row.device_id);
    }

    // Process each row
    for (const row of deviceTimeline) {
      const ms = new Date(row.date).getTime();
      const key = ms - (ms % SLOT_MS);

      let point = bySlot.get(key);
      if (!point) {
        const d = new Date(key);
        point = {
          slot: formatSlotLabel(d, tzOffset),
          hourStart: new Date(key).toISOString(),
        };
        // Initialize all devices to 0
        for (const deviceId of deviceIds) {
          point[deviceId] = 0;
        }
        bySlot.set(key, point);
      }
      point[row.device_id] =
        (point[row.device_id] as number) + row.total_tokens;
    }

    return Array.from(bySlot.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v);
  })();

  // Get device IDs for rendering bars
  const deviceIds = devices?.map((d) => d.device_id) ?? [];

  // Determine if we have data for the selected view
  const hasInOutData = data.length > 0;
  const hasDeviceData = deviceChartData.length > 0 && deviceIds.length > 0;
  const effectiveViewMode = viewMode === "devices" && !hasDeviceData ? "in-out" : viewMode;

  if (!hasInOutData && !hasDeviceData) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No usage data yet
      </div>
    );
  }

  // Determine tick interval: show ~12 ticks across all data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts accepts generic data arrays
  const chartData: any[] = effectiveViewMode === "devices" ? deviceChartData : data;
  const tickInterval = Math.max(1, Math.floor(chartData.length / 12));

  // Build legend items based on view mode
  const legendItems =
    effectiveViewMode === "in-out"
      ? [
          { key: "input", label: "Input", color: colorInput },
          { key: "output", label: "Output", color: colorOutput },
        ]
      : deviceIds.map((deviceId, i) => ({
          key: deviceId,
          label: deviceLabels.get(deviceId) ?? deviceId.slice(0, 8),
          color: CHART_COLORS[i % CHART_COLORS.length] as string,
        }));

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <p className="text-xs md:text-sm text-muted-foreground">
            Token Usage (30-min intervals)
          </p>
          {/* View mode toggle */}
          {hasDeviceData && onViewModeChange && (
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              {(["devices", "in-out"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                    effectiveViewMode === mode
                      ? "bg-secondary text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "devices" ? "By Device" : "In/Out"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {legendItems.slice(0, 6).map(({ key, label, color }) => (
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

      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <BarChart
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
              dataKey="slot"
              tickFormatter={fmtSlot}
              tick={{ fill: chartAxis, fontSize: 10 }}
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
            {effectiveViewMode === "in-out" ? (
              <>
                <Tooltip content={<InOutTooltip />} isAnimationActive={false} />
                <Bar
                  dataKey="input"
                  stackId="1"
                  fill={colorInput}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="output"
                  stackId="1"
                  fill={colorOutput}
                  radius={[2, 2, 0, 0]}
                />
              </>
            ) : (
              <>
                <Tooltip
                  content={<DevicesTooltip deviceLabels={deviceLabels} />}
                  isAnimationActive={false}
                />
                {deviceIds.map((deviceId, i) => (
                  <Bar
                    key={deviceId}
                    dataKey={deviceId}
                    stackId="1"
                    fill={CHART_COLORS[i % CHART_COLORS.length] as string}
                    radius={
                      i === deviceIds.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]
                    }
                  />
                ))}
              </>
            )}
          </BarChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

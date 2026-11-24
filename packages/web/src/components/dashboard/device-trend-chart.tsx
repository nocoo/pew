"use client";

import { CHART_ANIMATION } from "@/lib/chart-animation";
import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { cn, formatTokens } from "@/lib/utils";
import { Button } from "@nocoo/basalt/components/button";
import { chartAxis, CHART_COLORS } from "@/lib/palette";
import { toDeviceTrendPoints, buildDeviceLabelMap } from "@/lib/device-helpers";
import { nextHiddenLegendKeys } from "@/lib/chart-legend-filter";
import type { DeviceAggregate, DeviceTimelinePoint } from "@pew/core";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartSeriesTooltip } from "./chart-series-tooltip";
import { ChartLegendMore } from "./chart-legend-more";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceTrendChartProps {
  timeline: DeviceTimelinePoint[];
  devices: DeviceAggregate[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function DeviceTrendTooltip({
  active,
  payload,
  label,
  hiddenDevices,
  labelMap,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  hiddenDevices: Set<string>;
  labelMap: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;

  return (
    <ChartSeriesTooltip
      title={label ? fmtDate(label) : undefined}
      entries={payload
        .filter((entry) => !hiddenDevices.has(entry.dataKey))
        .map((entry) => ({ ...entry, name: labelMap.get(entry.dataKey) ?? entry.dataKey }))}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-line LineChart showing token usage per device over time.
 * Each device gets a distinct colored line.
 * Click legend to isolate, cmd/ctrl+click legend to toggle visibility.
 */
export function DeviceTrendChart({ timeline, devices, className }: DeviceTrendChartProps) {
  const [hiddenDevices, setHiddenDevices] = useState<Set<string>>(new Set());

  const chartData = useMemo(() => toDeviceTrendPoints(timeline), [timeline]);

  const labelMap = useMemo(() => buildDeviceLabelMap(devices), [devices]);

  const deviceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const pt of chartData) {
      for (const key of Object.keys(pt)) {
        if (key !== "date") keys.add(key);
      }
    }
    return Array.from(keys);
  }, [chartData]);

  if (!chartData.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-basalt-secondary ring-1 ring-basalt-border/80 shadow-basalt-card p-8 text-sm text-basalt-muted-foreground",
          className,
        )}
      >
        No device data yet
      </div>
    );
  }

  function handleLegendClick(deviceId: string, metaKey: boolean) {
    setHiddenDevices((prev) => {
      return nextHiddenLegendKeys({
        keys: deviceKeys,
        hiddenKeys: prev,
        targetKey: deviceId,
        metaKey,
      });
    });
  }

  return (
    <div
      className={cn(
        "rounded-card bg-basalt-secondary ring-1 ring-basalt-border/80 shadow-basalt-card p-4 md:p-5",
        className,
      )}
    >
      <div className="mb-4 space-y-3">
        <p className="text-xs md:text-sm text-basalt-muted-foreground">Device Trend</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {deviceKeys.slice(0, 5).map((deviceId, i) => {
            const isHidden = hiddenDevices.has(deviceId);
            return (
              <Button
                key={deviceId}
                type="button"
                variant="ghost"
                aria-pressed={!isHidden}
                onClick={(event) => handleLegendClick(deviceId, event.metaKey || event.ctrlKey)}
                className={cn(
                  "h-auto min-w-0 gap-1.5 p-0 text-xs font-normal transition-opacity",
                  isHidden && "opacity-40",
                )}
              >
                <div
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
                <span className="max-w-[160px] truncate text-xs text-basalt-muted-foreground">
                  {labelMap.get(deviceId) ?? deviceId}
                </span>
              </Button>
            );
          })}
          <ChartLegendMore
            items={deviceKeys.map((key, i) => ({
              key,
              label: labelMap.get(key) ?? key,
              color: CHART_COLORS[i % CHART_COLORS.length] as string,
            }))}
            hiddenKeys={hiddenDevices}
            onSelect={handleLegendClick}
          />
        </div>
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
              content={<DeviceTrendTooltip hiddenDevices={hiddenDevices} labelMap={labelMap} />}
              isAnimationActive={false}
            />
            {deviceKeys.map((deviceId, i) => (
              <Line
                {...CHART_ANIMATION}
                key={deviceId}
                type="monotone"
                dataKey={deviceId}
                stroke={CHART_COLORS[i % CHART_COLORS.length] as string}
                strokeWidth={2}
                dot={false}
                hide={hiddenDevices.has(deviceId)}
              />
            ))}
          </LineChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

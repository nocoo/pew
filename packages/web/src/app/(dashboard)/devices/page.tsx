"use client";

import { useMemo, useState } from "react";
import { useDeviceData } from "@/hooks/use-device-data";
import { useUsageData } from "@/hooks/use-usage-data";
import { formatTokens } from "@/lib/utils";
import { formatCost } from "@/hooks/use-pricing";
import { sourceLabel } from "@/hooks/use-usage-data";
import { deviceLabel, shortDeviceId, toDeviceAgentBreakdown, toDeviceModelBreakdown } from "@/lib/device-helpers";
import { toSourceTrendPoints } from "@/lib/usage-helpers";
import { toModelEvolutionPoints } from "@/lib/model-helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_COLORS } from "@/lib/palette";
import { DeviceTrendChart } from "@/components/dashboard/device-trend-chart";
import { DeviceShareChart } from "@/components/dashboard/device-share-chart";
import { DeviceBreakdownChart } from "@/components/dashboard/device-breakdown-chart";
import { DeviceAgentChart } from "@/components/dashboard/device-agent-chart";
import { DeviceModelChart } from "@/components/dashboard/device-model-chart";
import { DeviceAgentTrendChart } from "@/components/dashboard/device-agent-trend-chart";
import { DeviceModelTrendChart } from "@/components/dashboard/device-model-trend-chart";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { FilterDropdown } from "@/components/dashboard/filter-dropdown";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { periodToDateRange, periodLabel, getLocalToday, fillTimelineGaps } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";
import type { DeviceAggregate } from "@pew/core";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DevicesSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* Stat grid (3 cols) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>

      {/* 2-col chart grid (Trend + Share) */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            <Skeleton className="h-3 w-24 mb-4" />
            <Skeleton className="h-[240px] md:h-[280px] w-full" />
          </div>
        ))}
      </div>

      {/* Breakdown chart */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
        <Skeleton className="h-3 w-28 mb-4" />
        <Skeleton className="h-[200px] md:h-[240px] w-full" />
      </div>

      {/* Summary table */}
      <div className="rounded-xl bg-secondary p-1">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left"><Skeleton className="h-3 w-14" /></th>
              <th className="px-4 py-3 text-left hidden lg:table-cell"><Skeleton className="h-3 w-10" /></th>
              <th className="px-4 py-3 text-left hidden xl:table-cell"><Skeleton className="h-3 w-12" /></th>
              <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right"><Skeleton className="h-3 w-10 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden sm:table-cell"><Skeleton className="h-3 w-14 ml-auto" /></th>
              <th className="px-4 py-3 text-right hidden md:table-cell"><Skeleton className="h-3 w-10 ml-auto" /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-16" /></td>
                <td className="px-4 py-3 hidden xl:table-cell"><Skeleton className="h-4 w-16" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-14 ml-auto" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-2 w-full rounded-full" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Deep Dive skeleton */}
      <div className="space-y-3 md:space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-20" />
          <div className="h-px flex-1 bg-border/60" />
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
              <Skeleton className="h-3 w-20 mb-4" />
              <Skeleton className="h-[200px] w-full" />
            </div>
          ))}
        </div>
        {/* Trend charts skeleton row */}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
              <Skeleton className="h-3 w-24 mb-4" />
              <Skeleton className="h-[240px] md:h-[280px] w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Grid
// ---------------------------------------------------------------------------

function StatGrid({ devices }: { devices: DeviceAggregate[] }) {
  const deviceCount = devices.length;
  const mostActive = devices.length > 0 ? (devices[0] as (typeof devices)[number]) : null;
  const recentDays = 7;
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - recentDays);
  const recentCutoffStr = recentCutoff.toISOString();
  const recentlyActive = devices.filter(
    (d) => d.last_seen >= recentCutoffStr
  ).length;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Devices</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{deviceCount}</p>
      </div>
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Most Active</p>
        <p className="mt-1 text-lg font-bold truncate">
          {mostActive ? deviceLabel(mostActive) : "—"}
        </p>
      </div>
      <div className="rounded-[var(--radius-card)] bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Active (7d)</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {recentlyActive}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ByDevicePage() {
  const [period, setPeriod] = useState<Period>("all");
  const [selectedDevice, setSelectedDevice] = useState("");
  const { from, to } = periodToDateRange(period, new Date().getTimezoneOffset());

  const { data, loading, error } = useDeviceData({
    from,
    ...(to ? { to } : {}),
  });

  const devices = useMemo(() => data?.devices ?? [], [data]);

  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);
  const today = useMemo(() => getLocalToday(tzOffset), [tzOffset]);

  // Fill date gaps in device timeline so charts extend to today
  const timeline = useMemo(() => {
    const raw = data?.timeline ?? [];
    if (raw.length === 0) return raw;
    const deviceIds = [...new Set(raw.map((r) => r.device_id))];
    return fillTimelineGaps(raw, "date", (d) =>
      deviceIds.map((id) => ({
        date: d,
        device_id: id,
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
      })),
      today,
    );
  }, [data, today]);

  const grandTotal = useMemo(
    () => devices.reduce((sum, d) => sum + d.total_tokens, 0),
    [devices],
  );

  // Deep Dive: device dropdown options
  const deviceOptions = useMemo(
    () =>
      devices.map((d) => ({
        value: d.device_id,
        label: deviceLabel(d),
      })),
    [devices],
  );

  // Auto-select first device when data loads (and clear stale selection)
  const effectiveDevice = useMemo(() => {
    if (selectedDevice && devices.some((d) => d.device_id === selectedDevice)) {
      return selectedDevice;
    }
    return devices.length > 0 ? (devices[0] as DeviceAggregate).device_id : "";
  }, [selectedDevice, devices]);

  // Deep Dive: filter + aggregate detail rows for selected device
  const deviceDetails = useMemo(() => data?.deviceDetails ?? [], [data]);

  const filteredDetails = useMemo(
    () =>
      effectiveDevice
        ? deviceDetails.filter((d) => d.device_id === effectiveDevice)
        : [],
    [deviceDetails, effectiveDevice],
  );

  const agentBreakdown = useMemo(
    () => toDeviceAgentBreakdown(filteredDetails),
    [filteredDetails],
  );

  const modelBreakdown = useMemo(
    () => toDeviceModelBreakdown(filteredDetails),
    [filteredDetails],
  );

  // Deep Dive: time-series data for selected device (reuse usage.get with deviceId filter)
  const { data: deviceUsage } = useUsageData({
    from,
    ...(to ? { to } : {}),
    ...(effectiveDevice ? { deviceId: effectiveDevice } : {}),
    granularity: "day",
  });

  const agentTrend = useMemo(
    () => (deviceUsage ? toSourceTrendPoints(deviceUsage.records, tzOffset) : []),
    [deviceUsage, tzOffset],
  );

  const modelTrend = useMemo(
    () => (deviceUsage ? toModelEvolutionPoints(deviceUsage.records, 5, tzOffset) : []),
    [deviceUsage, tzOffset],
  );

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">By Device</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare usage across your devices ({subtitle}).
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load device data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && <DevicesSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {devices.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
              No device data yet. Sync from multiple devices to compare usage.
            </div>
          ) : (
            <>
              {/* Overview */}
              <DashboardSegment title="Overview">
                <StatGrid devices={devices} />
              </DashboardSegment>

              {/* Trend & Share */}
              <DashboardSegment title="Trend & Share">
                <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
                  <DeviceTrendChart timeline={timeline} devices={devices} />
                  <DeviceShareChart timeline={timeline} devices={devices} />
                </div>
              </DashboardSegment>

              {/* Breakdown */}
              <DashboardSegment title="Breakdown">
                <DeviceBreakdownChart devices={devices} />
              </DashboardSegment>

              {/* Summary table */}
              <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        Device
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">
                        Tools
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden xl:table-cell">
                        Models
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Input
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Output
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">
                        Cached
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Total
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">
                        Est. Cost
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-32 hidden md:table-cell">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device, i) => {
                      const pct =
                        grandTotal > 0
                          ? (device.total_tokens / grandTotal) * 100
                          : 0;
                      return (
                        <tr
                          key={device.device_id}
                          className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    CHART_COLORS[i % CHART_COLORS.length],
                                }}
                              />
                              <div>
                                <span className="text-sm font-medium text-foreground">
                                  {deviceLabel(device)}
                                </span>
                                {device.device_id !== "default" && (
                                  <span className="ml-2 text-[10px] font-mono text-muted-foreground/60">
                                    {shortDeviceId(device.device_id)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <div className="flex gap-1.5">
                              {device.sources.map((s) => (
                                <span
                                  key={s}
                                  className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                >
                                  {sourceLabel(s)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden xl:table-cell">
                            <span className="text-xs text-muted-foreground truncate block max-w-[200px]">
                              {device.models.length > 0
                                ? device.models.join(", ")
                                : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums">
                            {formatTokens(device.input_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums">
                            {formatTokens(device.output_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">
                            {formatTokens(device.cached_input_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">
                            {formatTokens(device.total_tokens)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums hidden sm:table-cell">
                            {formatCost(device.estimated_cost)}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-background overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor:
                                      CHART_COLORS[i % CHART_COLORS.length],
                                  }}
                                />
                              </div>
                              <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td className="px-4 py-3 text-sm font-medium" colSpan={3}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden md:table-cell" />
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-bold">
                        {formatTokens(grandTotal)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium hidden sm:table-cell">
                        {formatCost(
                          devices.reduce((s, d) => s + d.estimated_cost, 0),
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Deep Dive — agent × model drill-down */}
              <DashboardSegment
                title="Deep Dive"
                action={
                  <FilterDropdown
                    label="Device"
                    value={effectiveDevice}
                    onChange={setSelectedDevice}
                    options={deviceOptions}
                    allLabel="All Devices"
                  />
                }
              >
                <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
                  <DeviceAgentChart data={agentBreakdown} />
                  <DeviceModelChart data={modelBreakdown} />
                </div>
                <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
                  <DeviceAgentTrendChart data={agentTrend} />
                  <DeviceModelTrendChart data={modelTrend} />
                </div>
              </DashboardSegment>
            </>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { CHART_ANIMATION } from "@/lib/chart-animation";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@nocoo/basalt/components/button";
import { useDeviceData } from "@/hooks/use-device-data";
import { buildDeviceLabelMap, deviceLabel } from "@/lib/device-helpers";
import { shortModel } from "@/lib/model-helpers";
import { agentColor, chartAxis, chartMuted, CHART_COLORS, modelColor } from "@/lib/palette";
import { toUsageBreakdown, type UsageDimension } from "@/lib/usage-breakdown";
import { sourceLabel, type UsageRow } from "@/lib/usage-transforms";
import { formatTokens } from "@/lib/utils";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartLegendMore } from "./chart-legend-more";
import { ChartTooltip, ChartTooltipRow, ChartTooltipSummary } from "./chart-tooltip";

const DIMENSIONS = { model: "Model", harness: "Harness", device: "Device" } as const;

function dateLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function BreakdownTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);
  return <ChartTooltip title={label ? dateLabel(label) : undefined}>
    {entries.map((entry) => <ChartTooltipRow key={entry.dataKey} label={entry.name} color={entry.color} value={formatTokens(entry.value)} />)}
    <ChartTooltipSummary label="Total" value={formatTokens(entries.reduce((n, entry) => n + entry.value, 0))} />
  </ChartTooltip>;
}

/** Daily stacks and period shares always use the same series and accounting totals. */
export function UsageBreakdownCharts({ records, from, to, start, end, tzOffset, dimension, onDimensionChange }: {
  records: UsageRow[];
  from: string;
  to: string;
  start: string;
  end: string;
  tzOffset: number;
  dimension: UsageDimension;
  onDimensionChange: (dimension: UsageDimension) => void;
}) {
  const devices = useDeviceData({ from, to });
  const breakdown = useMemo(() => toUsageBreakdown(records, devices.data?.timeline ?? [], dimension, { start, end }, tzOffset),
    [records, devices.data, dimension, start, end, tzOffset]);
  const labels = useMemo(() => buildDeviceLabelMap(devices.data?.devices ?? []), [devices.data]);
  const series = breakdown.series.map((s, i) => ({ ...s,
    name: s.id === null ? `Other ${dimension === "harness" ? "harnesses" : `${dimension}s`}` : dimension === "model" ? s.id
      : dimension === "harness" ? sourceLabel(s.id) : labels.get(s.id) ?? deviceLabel({ device_id: s.id, alias: null }),
    color: s.id === null ? chartMuted : dimension === "model" ? modelColor(s.id).color
      : dimension === "harness" ? agentColor(s.id).color : CHART_COLORS[i % CHART_COLORS.length] as string,
  }));
  const legendLimit = dimension === "model" ? 5 : 6;
  const legendItems = series.map((s) => ({ key: s.key, label: s.name, color: s.color,
    value: `${formatTokens(s.total)} (${(s.total / breakdown.total * 100).toFixed(1)}%)` }));
  const loading = dimension === "device" && devices.loading;
  const error = dimension === "device" ? devices.error : null;
  const available = !loading && !error && breakdown.total > 0;
  const emptyMessage = loading ? "Loading device usage…" : error ? "Device usage unavailable" : "No tokens to display.";

  return <section aria-label="Usage breakdown" className="space-y-3">
    <fieldset aria-label="Breakdown dimension" className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
      {(Object.keys(DIMENSIONS) as UsageDimension[]).map((value) => <Button key={value} type="button" size="sm"
        variant={dimension === value ? "secondary" : "ghost"} aria-pressed={dimension === value} onClick={() => onDimensionChange(value)}>
        {DIMENSIONS[value]}
      </Button>)}
    </fieldset>
    <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <figure aria-label="Daily token breakdown" className="flex min-w-0 flex-col rounded-card bg-secondary p-4 md:p-5">
        <figcaption className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs md:text-sm text-muted-foreground">
          <span>Daily Tokens by {DIMENSIONS[dimension]}</span>
          <span className="text-xs">{dateLabel(start)} – {dateLabel(end)} · Local time</span>
        </figcaption>
        {error && <div className="mb-3">
          <ErrorBanner messagePrefix="Failed to load device usage" error={error} />
          <Button type="button" variant="ghost" size="sm" onClick={devices.refetch}>Retry device usage</Button>
        </div>}
        {available ? <>
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
            {series.slice(0, legendLimit).map((s) => <span key={s.key} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={s.name}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="max-w-[160px] truncate">{dimension === "model" ? shortModel(s.name) : s.name}</span>
            </span>)}
            <ChartLegendMore items={legendItems} visibleCount={legendLimit} />
          </div>
          <div className="min-h-[240px] flex-1 md:min-h-[280px]">
            <DashboardResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdown.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} maxBarSize={24}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartAxis} strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: chartAxis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={32} />
                <YAxis tickFormatter={formatTokens} tick={{ fill: chartAxis, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip content={<BreakdownTooltip />} isAnimationActive={false} />
                {series.map((s) => <Bar {...CHART_ANIMATION} key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId="tokens" />)}
              </BarChart>
            </DashboardResponsiveContainer>
          </div>
        </> : <div className="flex min-h-[280px] flex-1 items-center justify-center text-sm text-muted-foreground" role="status">{emptyMessage}</div>}
      </figure>
      <figure aria-label="Token share" className="flex min-w-0 flex-col rounded-card bg-secondary p-4 md:p-5">
        <figcaption className="flex items-center justify-between gap-2 text-xs md:text-sm text-muted-foreground">
          <span>{DIMENSIONS[dimension]} Share</span>
          {available && <span className="text-xs tabular-nums">{formatTokens(breakdown.total)} tokens</span>}
        </figcaption>
        {available ? <>
          <div className="mx-auto my-3 h-[160px] w-full max-w-[200px]">
            <DashboardResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie {...CHART_ANIMATION} data={series} dataKey="total" nameKey="name" innerRadius="55%" outerRadius="90%" strokeWidth={0} paddingAngle={series.length > 10 ? 0 : 2}>
                  {series.map((s) => <Cell key={s.key} fill={s.color} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  const item = payload?.[0]?.payload as typeof series[number] | undefined;
                  return active && item ? <ChartTooltip><ChartTooltipRow color={item.color} label={item.name}
                    value={`${formatTokens(item.total)} (${(item.total / breakdown.total * 100).toFixed(1)}%)`} /></ChartTooltip> : null;
                }} isAnimationActive={false} />
              </PieChart>
            </DashboardResponsiveContainer>
          </div>
          <div className="my-auto space-y-2">
            <ul className="space-y-2">
              {series.slice(0, legendLimit).map((s) => <li key={s.key} className="flex items-center gap-2 text-xs" title={s.name}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{dimension === "model" ? shortModel(s.name) : s.name}</span>
                <span className="shrink-0 tabular-nums">{formatTokens(s.total)}</span>
                <span className="w-11 shrink-0 text-right tabular-nums text-muted-foreground">{(s.total / breakdown.total * 100).toFixed(1)}%</span>
              </li>)}
            </ul>
            <ChartLegendMore items={legendItems} visibleCount={legendLimit} />
          </div>
        </> : <div className="flex min-h-[280px] flex-1 items-center justify-center text-sm text-muted-foreground">{emptyMessage}</div>}
      </figure>
    </div>
  </section>;
}

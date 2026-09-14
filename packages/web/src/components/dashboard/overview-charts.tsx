"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Database, DollarSign, Zap } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { formatCost } from "@/lib/pricing";
import { chart, chartAxis, withAlpha } from "@/lib/palette";
import { computePercentileBoundaries } from "@/lib/calendar-helpers";
import {
  metricIsComplete, rankOverviewGroups,
  type OverviewDay, type OverviewGroup, type OverviewMetric, type OverviewTotals,
} from "@/lib/overview-helpers";
import { HeatmapCalendar } from "./heatmap-calendar";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartTooltip, ChartTooltipRow, ChartTooltipSummary } from "./chart-tooltip";

const METRICS = {
  tokens: { label: "Total Tokens", unit: "Tokens", trend: "Daily tokens", color: chart.violet, token: "chart-1", icon: Zap },
  cost: { label: "Cost", unit: "Estimated cost", trend: "Daily estimated cost", color: chart.coral, token: "chart-4", icon: DollarSign },
  cache: { label: "Cache", unit: "Cache tokens", trend: "Daily cache tokens", color: chart.teal, token: "chart-9", icon: Database },
} as const;

function formatValue(value: number | null, metric: OverviewMetric): string {
  if (value === null) return "—";
  return metric === "cost" ? formatCost(value) : formatTokens(value);
}

function coverage(totals: OverviewTotals): string {
  return `Read coverage ${Math.round(totals.readCoverage * 100)}% · Write coverage ${Math.round(totals.writeCoverage * 100)}%`;
}

const panelClass = "min-w-0 rounded-card border border-border/50 bg-secondary p-4 md:p-6";

export function OverviewMetrics({ summary, metric, onChange, pricingLoading }: {
  summary: OverviewTotals;
  metric: OverviewMetric;
  onChange: (metric: OverviewMetric) => void;
  pricingLoading: boolean;
}) {
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
      <legend className="sr-only">Overview metrics</legend>
      {(["tokens", "cost", "cache"] as const).map((key) => {
        const { label, icon: Icon, color, token } = METRICS[key];
        const selected = key === metric;
        const complete = metricIsComplete(key, summary);
        return (
          <button
            key={key} type="button" aria-label={label} aria-pressed={selected}
            aria-controls="overview-charts" onClick={() => onChange(key)}
            className={cn(
              "relative flex min-w-0 flex-col overflow-hidden rounded-card border p-5 text-left transition-colors md:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selected ? "border-transparent" : "border-border/50 bg-secondary hover:bg-secondary/70",
            )}
            style={selected ? { background: withAlpha(token, 0.08), borderColor: withAlpha(token, 0.55) } : undefined}
          >
            <div className="mb-5 flex w-full items-center gap-2.5">
              <Icon className="h-4 w-4" style={{ color }} aria-hidden="true" strokeWidth={1.5} />
              <span className="text-sm font-medium">{label}</span>
              <span className="ml-auto h-4 w-4" style={{ color }}>{selected && <Check className="h-4 w-4" aria-hidden="true" />}</span>
            </div>
            <span className="text-4xl font-semibold tracking-tight tabular-nums lg:text-[2.75rem]" title={summary[key]?.toLocaleString("en-US")}>
              {key === "cost" && pricingLoading ? "…" : formatValue(summary[key], key)}
            </span>
            <span className="mt-2 text-xs text-muted-foreground">
              {key === "tokens" ? "Input + output, including cache & reasoning" : key === "cost" ? "Public-price estimate · USD" : "Known cache reads + writes"}
            </span>
            <div className="mt-5 flex w-full flex-wrap gap-x-4 gap-y-1 border-t border-border/40 pt-3 text-xs tabular-nums">
              {key === "tokens" ? <><span>Input {formatTokens(summary.input)}</span><span>Output {formatTokens(summary.output)}</span></> :
                key === "cost" ? <span className="text-muted-foreground">{pricingLoading ? "Loading prices…" : complete ? "Cache write charges included" : "Includes assumptions"}</span> :
                <><span>Read {formatValue(summary.cacheRead, "cache")}</span><span>Write {formatValue(summary.cacheWrite, "cache")}</span>
                  <span className="text-muted-foreground">{summary.cache === null ? "Unavailable" : complete ? "Complete counts" : "Partial counts"}</span></>}
            </div>
          </button>
        );
      })}
    </fieldset>
  );
}

export function OverviewHeatmap({ daily, metric }: { daily: OverviewDay[]; metric: OverviewMetric }) {
  const meta = METRICS[metric];
  const { data, years, boundaries, byDate, colorScale } = useMemo(() => {
    const data = daily.map((day) => ({ date: day.date, value: day[metric] }));
    const years = [...new Set(daily.map((day) => Number(day.date.slice(0, 4))))];
    const sorted = data.flatMap((d) => d.value !== null && d.value > 0 ? [d.value] : []).sort((a, b) => a - b);
    return { data, years, byDate: new Map(daily.map((day) => [day.date, day])),
      boundaries: computePercentileBoundaries(sorted, 4),
      colorScale: ["hsl(var(--basalt-muted))", ...[0.25, 0.45, 0.7, 1].map((alpha) => withAlpha(meta.token, alpha))],
    };
  }, [daily, metric, meta.token]);
  const first = daily[0]?.date;
  const last = daily[daily.length - 1]?.date;
  return (
    <section className={panelClass} aria-label="Activity heatmap">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Activity heatmap</h2>
          <p className="mt-1 text-xs text-muted-foreground">{meta.unit} per day · {daily.filter((day) => day.tokens > 0).length} active days</p>
        </div>
        <span className="text-xs text-muted-foreground">{metric === "cache" ? "Known counts · striped cells are unavailable" : "Color intensity shows daily usage"}</span>
      </div>
      {first && last ? (
        <div className="space-y-5">
          {years.map((year) => (
            <div key={year} className="flex min-w-0 flex-col gap-3 xl:flex-row xl:gap-5">
              <span className="text-xs font-medium tabular-nums text-muted-foreground xl:w-10 xl:pt-5">{year}</span>
              <HeatmapCalendar
                key={`${metric}-${first}-${last}`} data={data} year={year} dateRange={{ from: first, to: last }}
                focusDate={daily.findLast((day) => day.date.startsWith(String(year)) && day.tokens > 0)?.date ?? last}
                colorScale={colorScale} boundaries={boundaries} metricLabel={meta.unit} cellSize={13} cellGap={3}
                className="min-w-0 flex-1"
                valueFormatter={(value, date) => {
                  const day = byDate.get(date);
                  const amount = metric === "cost" ? formatCost(value) : value.toLocaleString("en-US");
                  return `${amount}${!day || metricIsComplete(metric, day) ? "" : metric === "cache" ? " known · partial" : " · includes assumptions"}`;
                }}
              />
            </div>
          ))}
        </div>
      ) : <p className="py-8 text-sm text-muted-foreground">No daily usage yet.</p>}
    </section>
  );
}

function TrendTooltip({ active, payload, metric }: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: OverviewDay }>;
  metric: OverviewMetric;
}) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;
  return (
    <ChartTooltip title={day.date}>
      {metric === "cache" && <>
        <ChartTooltipRow label="Cache read" value={formatValue(day.cacheRead, metric)} color={chart.teal} />
        <ChartTooltipRow label="Cache write" value={formatValue(day.cacheWrite, metric)} color={chart.gold} />
      </>}
      <ChartTooltipSummary label={METRICS[metric].unit} value={formatValue(day[metric], metric)} />
      {metric === "cache" && <p className="mt-2 text-xs text-muted-foreground">{day.input === 0 ? "No input recorded" : coverage(day)}</p>}
      {!metricIsComplete(metric, day) && <p className="mt-1 text-xs text-muted-foreground">{metric === "cache" ? "Known counts only; total may be higher." : "Estimate includes assumptions."}</p>}
    </ChartTooltip>
  );
}

export function OverviewTrend({ daily, metric }: { daily: OverviewDay[]; metric: OverviewMetric }) {
  const meta = METRICS[metric];
  const series = metric === "cache" ? [
    { key: "cache", label: "Known cache", color: chart.teal, dash: undefined },
    { key: "cacheRead", label: "Read", color: chart.teal, dash: "4 4" },
    { key: "cacheWrite", label: "Write", color: chart.gold, dash: "4 4" },
  ] : [{ key: metric, label: meta.unit, color: meta.color, dash: undefined }];
  return (
    <section className={panelClass} aria-label="Daily trend">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{meta.trend}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{metric === "cache" ? "Unknown days stay as gaps; partial days show known counts." : metric === "cost" ? "Token charges at public prices, including cache write charges." : "Daily total across all harnesses and models."}</p>
        </div>
        <div className="flex gap-4">
          {series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-3 border-t-2" style={{ borderColor: s.color, borderTopStyle: s.dash ? "dashed" : "solid" }} />{s.label}
          </span>)}
        </div>
      </div>
      <div className="h-[240px] md:h-[280px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartAxis} strokeOpacity={0.15} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              tick={{ fill: chartAxis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={32} />
            <YAxis tickFormatter={(value: number) => formatValue(value, metric)} tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false} tickLine={false} width={64} domain={[0, "auto"]} />
            <Tooltip content={<TrendTooltip metric={metric} />} filterNull={false} isAnimationActive={false} />
            {series.map((s) => <Line key={s.key} type="linear" dataKey={s.key} name={s.label}
              stroke={s.color} strokeWidth={s.dash ? 1.5 : 2.5} {...(s.dash ? { strokeDasharray: s.dash } : {})}
              dot={metric === "cache" || daily.length <= 7 ? { r: s.dash ? 1.5 : 2.5 } : false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
          </LineChart>
        </DashboardResponsiveContainer>
      </div>
    </section>
  );
}

export function OverviewBreakdown({ dimension, groups, metric, label, loading = false, error, onRetry }: {
  dimension: "machine" | "model" | "harness";
  groups: OverviewGroup[];
  metric: OverviewMetric;
  label: (id: string) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ranked = rankOverviewGroups(groups, metric);
  const visible = expanded ? ranked : ranked.slice(0, 6);
  const maximum = ranked[0]?.[metric] ?? 0;
  const meta = METRICS[metric];
  return (
    <section className={cn(panelClass, "flex flex-col")} aria-label={`By ${dimension}`}>
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium capitalize">By {dimension}</h2>
        <span className="text-xs text-muted-foreground">{meta.unit}</span>
      </div>
      {loading ? <p className="py-6 text-sm text-muted-foreground">Loading machines…</p> : error ? (
        <div className="py-6 text-sm text-muted-foreground">
          <p>Could not load machine usage.</p>
          <button type="button" className="mt-2 underline underline-offset-4" onClick={onRetry}>Retry</button>
        </div>
      ) : ranked.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No {dimension} usage in this period.</p> : (
        <ol className="space-y-4">
          {visible.map((row) => {
            const value = row[metric];
            const complete = metricIsComplete(metric, row);
            const name = label(row.id);
            return (
              <li key={row.id} className="space-y-1.5">
                <div className="flex min-w-0 items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium" title={name}>{name}</span>
                  <span className="shrink-0 font-medium tabular-nums" title={value?.toLocaleString("en-US")}>{formatValue(value, metric)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${maximum > 0 && value !== null ? value / maximum * 100 : 0}%`, backgroundColor: meta.color }} />
                </div>
                {!complete && <p className="text-[11px] text-muted-foreground" title={metric === "cache" ? coverage(row) : undefined}>
                  {value === null ? "Unavailable" : metric === "cache" ? "Partial" : "Includes assumptions"}
                </p>}
              </li>
            );
          })}
        </ol>
      )}
      {!loading && !error && ranked.length > 6 && <button type="button" className="mt-5 self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${ranked.length}`}</button>}
    </section>
  );
}

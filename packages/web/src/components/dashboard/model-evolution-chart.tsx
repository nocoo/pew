"use client";

import { useId, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { CHART_ANIMATION } from "@/lib/chart-animation";
import { chartAxis, chartMuted, modelColor } from "@/lib/palette";
import { shortModel } from "@/lib/model-helpers";
import { toUsageBreakdown } from "@/lib/usage-breakdown";
import { toLocalDateStr, type UsageRow } from "@/lib/usage-transforms";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartLegendMore } from "./chart-legend-more";
import { ChartSeriesTooltip } from "./chart-series-tooltip";

function fmtDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ModelEvolutionChart({ records, tzOffset, end, title = "Model Evolution" }: {
  records: UsageRow[];
  tzOffset: number;
  end?: string;
  title?: string;
}) {
  const id = useId();
  const breakdown = useMemo(() => {
    if (!records.length) return { daily: [], series: [], total: 0 };
    const dates = records.map((row) => toLocalDateStr(row.hour_start, tzOffset)).sort();
    return toUsageBreakdown(records, [], "model", { start: dates[0] ?? "", end: end ?? dates.at(-1) ?? "" }, tzOffset);
  }, [records, tzOffset, end]);
  const series = breakdown.series.map((s) => ({ ...s, name: s.id ?? "Other models", color: s.id === null ? chartMuted : modelColor(s.id).color }));
  const chartData = breakdown.daily.map((point) => {
    const total = breakdown.series.reduce((sum, s) => sum + Number(point[s.key]), 0);
    return { date: point.date, ...Object.fromEntries(breakdown.series.map((s) => [s.key, total ? Number(point[s.key]) / total * 100 : 0])) };
  });

  if (!breakdown.total) return <div className="flex items-center justify-center rounded-card bg-basalt-secondary p-8 text-sm text-basalt-muted-foreground">No model data yet</div>;

  return <figure aria-label={title} className="min-w-0 rounded-card bg-basalt-secondary p-4 md:p-5">
    <p className="mb-3 text-xs md:text-sm text-basalt-muted-foreground">{title}</p>
    <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
      {series.slice(0, 5).map((s) => <span key={s.key} className="flex min-w-0 items-center gap-1.5 text-xs text-basalt-muted-foreground" title={s.name}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
        <span className="max-w-[160px] truncate">{shortModel(s.name)}</span>
      </span>)}
      <ChartLegendMore items={series.map((s) => ({ key: s.key, label: s.name, color: s.color }))} />
    </div>
    <div className="h-[240px] md:h-[280px]">
      <DashboardResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>{series.map((s) => <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.6} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0.2} />
          </linearGradient>)}</defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chartAxis} strokeOpacity={0.15} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: chartAxis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={32} />
          <YAxis tickFormatter={(value: number) => `${Math.round(value)}%`} tick={{ fill: chartAxis, fontSize: 11 }} axisLine={false} tickLine={false} width={44} domain={[0, 100]} />
          <Tooltip isAnimationActive={false} content={({ active, payload, label }) => active && payload?.length
            ? <ChartSeriesTooltip title={fmtDate(String(label))} percentage entries={payload.map((entry) => ({ dataKey: String(entry.dataKey),
              name: String(entry.name), value: Number(entry.value), color: entry.color ?? chartMuted }))} /> : null} />
          {series.map((s) => <Area {...CHART_ANIMATION} key={s.key} type="monotone" dataKey={s.key} name={s.name}
            stackId="models" stroke={s.color} strokeWidth={1.5} fill={`url(#${id}-${s.key})`} />)}
        </AreaChart>
      </DashboardResponsiveContainer>
    </div>
  </figure>;
}

"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, DollarSign, Gauge, Info, TrendingUp, Zap, type LucideIcon } from "lucide-react";
import { Button } from "@nocoo/basalt/components/button";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@nocoo/basalt/components/popover";
import { useUsageData, toHeatmapData, type DailyPoint } from "@/hooks/use-usage-data";
import { useTzOffset } from "@/hooks/use-tz-offset";
import { usePricingMap, formatCost } from "@/hooks/use-pricing";
import { summarizeAccounting } from "@/lib/accounting";
import type { UsageDimension } from "@/lib/usage-breakdown";
import { computeTotalCost, toDailyCostPoints, computeCacheSavings, forecastMonthlyCost, toDailyCacheRates, type DailyCostPoint, type DailyCacheRate } from "@/lib/cost-helpers";
import { compareWeekdayWeekend, computeMoMGrowth, computeWoWGrowth, toHourlyWeekdayWeekend } from "@/lib/usage-helpers";
import { fillDateRange, getLocalToday, periodLabel, periodToUtcRange, type Period } from "@/lib/date-helpers";
import { formatTokens } from "@/lib/utils";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { HeatmapHero } from "@/components/dashboard/heatmap-hero";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { CostTrendChart } from "@/components/dashboard/cost-trend-chart";
import { CacheRateChart } from "@/components/dashboard/cache-rate-chart";
import { UsageBreakdownCharts } from "@/components/dashboard/usage-breakdown-charts";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { IoRatioChart } from "@/components/dashboard/io-ratio-chart";
import { WeekdayWeekendChart } from "@/components/dashboard/weekday-weekend-chart";
import { HourlyChart } from "@/components/dashboard/hourly-chart";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { SalaryCalculatorCard } from "@/components/dashboard/salary-estimator-card";
import { AccountingNotice } from "@/components/dashboard/accounting-notice";
import { UsageTimingNotice } from "@/components/dashboard/usage-timing-notice";
import { SnapshotAlert } from "@/components/dashboard/snapshot-alert";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [chartTab, setChartTab] = useState<"tokens" | "cost">("tokens");
  const [breakdownDimension, setBreakdownDimension] = useState<UsageDimension>("model");
  const tzOffset = useTzOffset();
  const today = useMemo(() => getLocalToday(tzOffset), [tzOffset]);
  const range = useMemo(() => periodToUtcRange(period, today, tzOffset), [period, today, tzOffset]);
  const { data, daily, sources, models, loading, error, refetch } = useUsageData({ from: range.from, to: range.to });
  const records = useMemo(() => data?.records ?? [], [data]);
  const hasRecords = records.length > 0;
  const { pricingMap, loading: pricingLoading } = usePricingMap();
  const currentYear = Number(today.slice(0, 4));
  const firstDay = range.start ?? daily[0]?.date ?? today;

  const yearData = useUsageData({
    from: new Date(Date.UTC(currentYear, 0, 1) + tzOffset * 60_000).toISOString(),
    to: range.to,
  });
  const halfHourData = useUsageData({ from: range.from, to: range.to, granularity: "half-hour" });
  const wowData = useUsageData({ days: 14, granularity: "half-hour" });
  const momData = useUsageData({ days: 62, granularity: "half-hour" });

  const accounting = useMemo(() => summarizeAccounting(records), [records]);
  const yearTotalTokens = useMemo(() => summarizeAccounting(yearData.data?.records ?? []).totalTokens, [yearData.data]);
  const estimatedCost = useMemo(() => computeTotalCost(models, pricingMap), [models, pricingMap]);
  const cacheSavings = useMemo(() => computeCacheSavings(models, pricingMap), [models, pricingMap]);

  const filledDaily = useMemo(() => {
    const zero = (date: string): DailyPoint => ({ date, input: 0, output: 0, cached: 0, reasoning: 0, total: 0 });
    return fillDateRange([zero(firstDay), ...daily], "date", zero, today);
  }, [daily, firstDay, today]);

  const dailyCostPoints = useMemo(() => {
    const zero = (date: string): DailyCostPoint => ({ date, inputCost: 0, outputCost: 0, cachedCost: 0, totalCost: 0 });
    return fillDateRange([zero(firstDay), ...toDailyCostPoints(records, pricingMap, tzOffset)], "date", zero, today);
  }, [records, pricingMap, tzOffset, firstDay, today]);

  const dailyCacheRates = useMemo(() => {
    const zero = (date: string): DailyCacheRate => ({
      date, cacheRate: null, cachedTokens: 0, inputTokens: 0, coverage: 0, coveredInputTokens: 0,
    });
    return fillDateRange([zero(firstDay), ...toDailyCacheRates(records, tzOffset)], "date", zero, today);
  }, [records, tzOffset, firstDay, today]);

  // Comparisons and the monthly forecast need complete calendar windows,
  // including when the selected usage period is only the current week.
  const wow = useMemo(() => wowData.data
    ? computeWoWGrowth(wowData.data.records, pricingMap, undefined, tzOffset) : null,
  [wowData.data, pricingMap, tzOffset]);
  const mom = useMemo(() => momData.data
    ? computeMoMGrowth(momData.data.records, pricingMap, undefined, tzOffset) : null,
  [momData.data, pricingMap, tzOffset]);
  const costForecast = useMemo(() => momData.data
    ? forecastMonthlyCost(toDailyCostPoints(momData.data.records, pricingMap, tzOffset)) : null,
  [momData.data, pricingMap, tzOffset]);

  const weekdayWeekend = useMemo(() => halfHourData.data
    ? compareWeekdayWeekend(halfHourData.data.records, { from: firstDay, to: today }, pricingMap, tzOffset) : null,
  [halfHourData.data, firstDay, today, pricingMap, tzOffset]);
  const hourlyData = useMemo(() => halfHourData.data
    ? toHourlyWeekdayWeekend(halfHourData.data.records, { from: firstDay, to: today }, tzOffset) : [],
  [halfHourData.data, firstDay, today, tzOffset]);

  return (
    <div className="space-y-4 md:space-y-6">
      <SnapshotAlert />
      <PageHeader title="Overview" description="Token usage and cache efficiency for your AI coding tools."
        actions={<>
          <PeriodSelector value={period} onChange={setPeriod} />
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Overview information">
                <Info className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Overview information" align="end" collisionPadding={16}
              className="w-80 max-w-[calc(100vw-2rem)] space-y-3 text-sm">
              <p>The selected period applies to Usage Summary, Salary Calculator, Trends and Insights. Calendar weeks start on Sunday.</p>
              <p>Activity and Goal Tracker always show {currentYear}. Week / month comparisons use their own calendar periods; Monthly Forecast and Daily Average always use this month.</p>
              <p>Model charts prioritize the most-used models in the seven days ending on this period’s latest usage date, then earlier weeks. Token counts and shares cover the full selected period, with remaining models grouped as Other.</p>
              <UsageTimingNotice records={records} />
            </PopoverContent>
          </Popover>
        </>} />
      <ErrorBanner messagePrefix="Failed to load usage data" error={error} />
      {error && <button type="button" className="text-sm underline underline-offset-4" onClick={refetch}>Retry usage</button>}
      {loading && <DashboardSkeleton />}
      {!loading && data && !hasRecords && period === "all" && <DashboardEmptyState />}

      {!loading && data && (hasRecords || period !== "all") && <>
        {!hasRecords && <p className="rounded-card bg-secondary px-4 py-3 text-sm text-muted-foreground">No usage in this period.</p>}

        <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <ErrorBanner messagePrefix="Failed to load annual activity" error={yearData.error} />
            {!yearData.error && <HeatmapHero
              data={toHeatmapData(yearData.daily)} year={currentYear} totalTokens={yearTotalTokens}
              activeDays={yearData.daily.filter((day) => day.total > 0).length} loading={yearData.loading}
              className="h-full"
            />}
          </div>
          <SalaryCalculatorCard dailyCosts={dailyCostPoints}
            dailyAverageCost={dailyCostPoints.length > 0 ? estimatedCost / dailyCostPoints.length : 0}
            rangeLabel={periodLabel(period)} incomplete={cacheSavings.netSavings === null}
            disabled={pricingLoading || !hasRecords} />
        </div>

        <DashboardSegment title="Usage summary"
          hint="Changes compare this week / month so far with the previous period. TD compares the same elapsed days. Cost estimates use public pricing.">
          <ErrorBanner messagePrefix="Failed to load growth comparisons" error={wowData.error ?? momData.error} />
          <StatGrid columns={3} className="sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            <StatCard
              title="Total Tokens" value={formatTokens(accounting.totalTokens)} subtitle={periodLabel(period)}
              icon={Zap} iconColor="text-primary" variant="primary"
              className="p-4 md:p-5"
              accentColor="bg-gradient-to-r from-primary to-chart-8"
              trendsLayout="grid"
              trends={[
                ...(wow && wow.previousWeekSameDay.tokens > 0
                  ? [{ value: Math.round(wow.sameDayTokenGrowth), label: "vs week TD" }] : []),
                ...(wow && wow.previousWeek.tokens > 0
                  ? [{ value: Math.round(wow.tokenGrowth), label: "vs last week" }] : []),
                ...(mom && mom.previousMonthSameDate.tokens > 0
                  ? [{ value: Math.round(mom.sameDateTokenGrowth), label: "vs month TD" }] : []),
                ...(mom && mom.previousMonth.tokens > 0
                  ? [{ value: Math.round(mom.tokenGrowth), label: "vs last month" }] : []),
              ]}
            >
              <SummaryDetails items={[
                { title: "Input Tokens", value: formatTokens(accounting.inputTokens), subtitle: "Prompts & context", icon: ArrowDownToLine, iconColor: "text-chart-3" },
                { title: "Output Tokens", value: formatTokens(accounting.outputTokens), subtitle: "Responses & reasoning", icon: ArrowUpFromLine, iconColor: "text-chart-5" },
              ]} />
            </StatCard>
            <StatCard title="Cache Hit Rate" className="p-4 md:p-5"
              value={accounting.readCoverage > 0 ? `${accounting.cacheReadRate.toFixed(1)}%` : "—"}
              subtitle={accounting.inputTokens === 0 ? "No input recorded" : accounting.readCoverage === 0
                ? "Read counts unavailable" : `Token based · ${Math.floor(accounting.readCoverage * 100)}% read coverage${accounting.readCoverage < 1 ? " · partial" : ""}`}
              icon={Gauge} iconColor="text-chart-2" accentColor="bg-chart-2" variant="primary">
              {accounting.readCoverage > 0 && <div className="mt-4 mb-2 space-y-2">
                <meter aria-label="Cache hit rate" min={0} max={100} value={accounting.cacheReadRate} className="sr-only" />
                <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div key={accounting.cacheReadRate} className="chart-animate chart-grow-x h-full rounded-full bg-chart-2" style={{ width: `${accounting.cacheReadRate}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">Share of known input served from cache</p>
              </div>}
              <SummaryDetails items={[
                { title: "Cache Read", value: accounting.inputTokens === 0 || accounting.readCoverage > 0 ? formatTokens(accounting.cacheReadTokens) : "—",
                  subtitle: accounting.inputTokens === 0 ? "No input recorded" : accounting.readCoverage > 0 ? `${Math.floor(accounting.readCoverage * 100)}% input covered${accounting.readCoverage < 1 ? " · partial" : ""}` : "Unavailable", icon: ArrowDownToLine, iconColor: "text-chart-2" },
                { title: "Cache Write", value: accounting.inputTokens === 0 || accounting.writeCoverage > 0 ? formatTokens(accounting.cacheWriteTokens) : "—",
                  subtitle: accounting.inputTokens === 0 ? "No input recorded" : accounting.writeCoverage > 0 ? `${Math.floor(accounting.writeCoverage * 100)}% input covered${accounting.writeCoverage < 1 ? " · partial" : ""}` : "Unavailable", icon: ArrowUpFromLine, iconColor: "text-chart-5" },
              ]} />
            </StatCard>
            <StatCard
              title="Est. Cost" value={pricingLoading ? "…" : formatCost(estimatedCost)}
              subtitle={cacheSavings.netSavings === null ? "Public-price estimate · incomplete details" : "Based on public pricing"}
              icon={DollarSign} iconColor="text-chart-6" variant="primary" accentColor="bg-chart-6"
              className="p-4 md:p-5 lg:col-span-2 xl:col-span-1"
              trendsLayout="grid" trendUpIsGood={false}
              trends={[
                ...(wow && wow.previousWeekSameDay.cost > 0
                  ? [{ value: Math.round(wow.sameDayCostGrowth), label: "vs week TD" }] : []),
                ...(wow && wow.previousWeek.cost > 0
                  ? [{ value: Math.round(wow.costGrowth), label: "vs last week" }] : []),
                ...(mom && mom.previousMonthSameDate.cost > 0
                  ? [{ value: Math.round(mom.sameDateCostGrowth), label: "vs month TD" }] : []),
                ...(mom && mom.previousMonth.cost > 0
                  ? [{ value: Math.round(mom.costGrowth), label: "vs last month" }] : []),
              ]}
            >
              <SummaryDetails items={[
                { title: "Monthly Forecast", value: pricingLoading || momData.loading ? "…" : costForecast ? formatCost(costForecast.projectedMonthCost) : "—",
                  subtitle: costForecast ? `This month · ${formatCost(costForecast.currentMonthCost)} so far` : "This month · Not enough data", icon: TrendingUp, iconColor: "text-chart-6" },
                { title: "Daily Average", value: pricingLoading || momData.loading ? "…" : costForecast ? formatCost(costForecast.dailyAverage) : "—",
                  subtitle: costForecast ? `This month · ${costForecast.daysInMonth - costForecast.daysElapsed} days left` : "This month · Not enough data", icon: DollarSign, iconColor: "text-chart-6" },
              ]} />
            </StatCard>
          </StatGrid>
          {hasRecords && <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-lg py-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Cache & cost details
            </summary>
            <div className="mt-3"><AccountingNotice records={records} pricingMap={pricingMap} loading={pricingLoading} /></div>
          </details>}
        </DashboardSegment>

        <DashboardSegment title="Trends">
          <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-3 md:gap-4">
              <div>
                <div className="mb-3 flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
                  {(["tokens", "cost"] as const).map((tab) => (
                    <Button key={tab} type="button" size="sm" aria-pressed={chartTab === tab}
                      variant={chartTab === tab ? "secondary" : "ghost"} onClick={() => setChartTab(tab)}>
                      {tab === "tokens" ? "Tokens" : "Cost"}
                    </Button>
                  ))}
                </div>
                {chartTab === "tokens" ? <UsageTrendChart data={filledDaily} /> : <CostTrendChart data={dailyCostPoints} />}
              </div>
              <CacheRateChart data={dailyCacheRates} />
            </div>
            <div className="flex min-w-0 flex-col gap-3 md:gap-4">
              <div className="hidden h-7 shrink-0 lg:block" />
              <SourceDonutChart data={sources} className="flex-1" />
              <IoRatioChart inputTokens={accounting.inputTokens} outputTokens={accounting.outputTokens} />
            </div>
          </div>
          <UsageBreakdownCharts records={records} from={range.from} to={range.to} start={firstDay} end={today} tzOffset={tzOffset}
            dimension={breakdownDimension} onDimensionChange={setBreakdownDimension} />
        </DashboardSegment>

        <DashboardSegment title="Insights">
          <ErrorBanner messagePrefix="Failed to load usage insights" error={halfHourData.error} />
          {weekdayWeekend && <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2">
            <WeekdayWeekendChart stats={weekdayWeekend} />
            <HourlyChart data={hourlyData} />
          </div>}
        </DashboardSegment>
      </>}
    </div>
  );
}

function SummaryDetails({ items }: { items: { title: string; value: string; subtitle: string; icon: LucideIcon; iconColor: string }[] }) {
  return (
    <div className="mt-auto pt-4">
      <dl className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3">
        {items.map(({ title, value, subtitle, icon: Icon, iconColor }) => <div key={title} className="min-w-0">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} strokeWidth={1.5} aria-hidden="true" />
            <span>{title}</span>
          </dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums tracking-tight">{value}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{subtitle}</dd>
        </div>)}
      </dl>
    </div>
  );
}

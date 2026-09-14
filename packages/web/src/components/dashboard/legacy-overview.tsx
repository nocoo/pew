"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Database, DollarSign, PiggyBank, TrendingUp, Zap } from "lucide-react";
import { Button } from "@nocoo/basalt/components/button";
import { useUsageData, toHeatmapData, type DailyPoint, type UsageRow } from "@/hooks/use-usage-data";
import { useDerivedUsageData } from "@/hooks/use-derived-usage-data";
import { usePricingMap, formatCost } from "@/hooks/use-pricing";
import { summarizeAccounting } from "@/lib/accounting";
import { computeTotalCost, toDailyCostPoints, computeCacheSavings, forecastMonthlyCost, toDailyCacheRates, type DailyCostPoint, type DailyCacheRate } from "@/lib/cost-helpers";
import { compareWeekdayWeekend, computeMoMGrowth, computeWoWGrowth, toHourlyWeekdayWeekend } from "@/lib/usage-helpers";
import { fillDateRange, periodLabel, type Period } from "@/lib/date-helpers";
import type { overviewDateRange } from "@/lib/overview-helpers";
import { formatTokens } from "@/lib/utils";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { HeatmapHero } from "@/components/dashboard/heatmap-hero";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { CostTrendChart } from "@/components/dashboard/cost-trend-chart";
import { CacheRateChart } from "@/components/dashboard/cache-rate-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { IoRatioChart } from "@/components/dashboard/io-ratio-chart";
import { WeekdayWeekendChart } from "@/components/dashboard/weekday-weekend-chart";
import { HourlyChart } from "@/components/dashboard/hourly-chart";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { ErrorBanner } from "@/components/ui/error-banner";

interface LegacyOverviewProps {
  records: UsageRow[];
  range: ReturnType<typeof overviewDateRange>;
  tzOffset: number;
  period: Period;
  onPeriodChange: (period: Period) => void;
}

export function LegacyOverview({ records, range, tzOffset, period, onPeriodChange }: LegacyOverviewProps) {
  const [chartTab, setChartTab] = useState<"tokens" | "cost">("tokens");
  const { daily, sources, models } = useDerivedUsageData(records, tzOffset);
  const { pricingMap, loading: pricingLoading } = usePricingMap();
  const today = range.end;
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
    <section aria-label="Legacy area" className="space-y-6 border-t border-border pt-8 md:pt-10">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Legacy area</h2>
        <p className="text-sm text-muted-foreground">
          Original dashboard widgets. Usage follows the selected period; activity and goals show {currentYear}.
        </p>
      </div>

      <ErrorBanner messagePrefix="Failed to load annual activity" error={yearData.error} />
      {!yearData.error && <HeatmapHero
        data={toHeatmapData(yearData.daily)} year={currentYear} totalTokens={yearTotalTokens}
        activeDays={yearData.daily.filter((day) => day.total > 0).length} loading={yearData.loading}
      />}

      <DashboardSegment title="Usage summary" action={<PeriodSelector value={period} onChange={onPeriodChange} />}>
        <ErrorBanner messagePrefix="Failed to load growth comparisons" error={wowData.error ?? momData.error} />
        <StatGrid columns={4}>
          <StatCard
            title="Total Tokens" value={formatTokens(accounting.totalTokens)} subtitle={periodLabel(period)}
            icon={Zap} iconColor="text-primary" variant="primary"
            accentColor="bg-gradient-to-r from-primary to-chart-8" trendsLayout="side"
            trends={[
              ...(wow && wow.previousWeekSameDay.tokens > 0 && wow.previousWeekSameDay.tokens !== wow.previousWeek.tokens
                ? [{ value: Math.round(wow.sameDayTokenGrowth), label: "vs week TD" }] : []),
              ...(wow && wow.previousWeek.tokens > 0
                ? [{ value: Math.round(wow.tokenGrowth), label: "vs last week" }] : []),
              ...(mom && mom.previousMonthSameDate.tokens > 0 && mom.previousMonthSameDate.tokens !== mom.previousMonth.tokens
                ? [{ value: Math.round(mom.sameDateTokenGrowth), label: "vs month TD" }] : []),
              ...(mom && mom.previousMonth.tokens > 0
                ? [{ value: Math.round(mom.tokenGrowth), label: "vs last month" }] : []),
            ]}
          />
          <StatCard title="Input Tokens" value={formatTokens(accounting.inputTokens)}
            subtitle="Prompts & context" icon={ArrowDownToLine} accentColor="bg-chart-3" />
          <StatCard title="Output Tokens" value={formatTokens(accounting.outputTokens)}
            subtitle="Responses & reasoning" icon={ArrowUpFromLine} accentColor="bg-chart-5" />
          <StatCard title="Cache Read Tokens"
            value={accounting.inputTokens === 0 || accounting.readCoverage > 0 ? formatTokens(accounting.cacheReadTokens) : "—"}
            subtitle={accounting.inputTokens === 0 ? "No input recorded" : accounting.readCoverage === 0
              ? "Read counts unavailable" : `${Math.round(accounting.cacheReadRate)}% of input with known read counts`}
            icon={Database} accentColor="bg-chart-2" />
        </StatGrid>

        <StatGrid columns={costForecast ? 4 : 2}>
          <StatCard
            title="Est. Cost" value={pricingLoading ? "…" : formatCost(estimatedCost)}
            subtitle={cacheSavings.netSavings === null ? "Public-price estimate · incomplete details" : "Based on public pricing"}
            icon={DollarSign} iconColor="text-chart-6" variant="primary" trendsLayout="side"
            trends={[
              ...(wow && wow.previousWeekSameDay.cost > 0 && wow.previousWeekSameDay.cost !== wow.previousWeek.cost
                ? [{ value: -Math.round(wow.sameDayCostGrowth), label: "vs week TD" }] : []),
              ...(wow && wow.previousWeek.cost > 0
                ? [{ value: -Math.round(wow.costGrowth), label: "vs last week" }] : []),
              ...(mom && mom.previousMonthSameDate.cost > 0 && mom.previousMonthSameDate.cost !== mom.previousMonth.cost
                ? [{ value: -Math.round(mom.sameDateCostGrowth), label: "vs month TD" }] : []),
              ...(mom && mom.previousMonth.cost > 0
                ? [{ value: -Math.round(mom.costGrowth), label: "vs last month" }] : []),
            ]}
          />
          <StatCard title="Net Cache Savings"
            value={pricingLoading ? "…" : cacheSavings.netSavings === null ? "—" : formatCost(cacheSavings.netSavings)}
            subtitle={cacheSavings.netSavings === null ? "Cache or pricing details incomplete" : "Read discount less write premium"}
            icon={PiggyBank} iconColor={(cacheSavings.netSavings ?? 0) < 0 ? "text-destructive" : "text-success"} />
          {costForecast && <>
            <StatCard title="Monthly Forecast" value={pricingLoading ? "…" : formatCost(costForecast.projectedMonthCost)}
              subtitle={`This Month · ${formatCost(costForecast.currentMonthCost)} estimated so far (${costForecast.daysElapsed} days)`}
              icon={TrendingUp} iconColor="text-chart-6" />
            <StatCard title="Daily Average" value={pricingLoading ? "…" : formatCost(costForecast.dailyAverage)}
              subtitle={`This Month · ${costForecast.daysInMonth - costForecast.daysElapsed} days remaining`}
              icon={DollarSign} iconColor="text-muted-foreground" />
          </>}
        </StatGrid>
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
      </DashboardSegment>

      <DashboardSegment title="Insights">
        <ErrorBanner messagePrefix="Failed to load usage insights" error={halfHourData.error} />
        {weekdayWeekend && <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2">
          <WeekdayWeekendChart stats={weekdayWeekend} />
          <HourlyChart data={hourlyData} />
        </div>}
      </DashboardSegment>
    </section>
  );
}

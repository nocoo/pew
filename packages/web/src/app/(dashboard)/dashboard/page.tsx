"use client";

import { useMemo, useState } from "react";
import {
  Zap,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  DollarSign,
  PiggyBank,
  TrendingUp,
} from "lucide-react";
import { useUsageData, toHeatmapData } from "@/hooks/use-usage-data";
import { formatTokens, cn } from "@/lib/utils";
import { usePricingMap, formatCost } from "@/hooks/use-pricing";
import { computeTotalCost, toDailyCostPoints, computeCacheSavings, forecastMonthlyCost, toDailyCacheRates, computeCurrentMonthTokens } from "@/lib/cost-helpers";
import { compareWeekdayWeekend, computeMoMGrowth, computeStreak, toLocalDailyBuckets } from "@/lib/usage-helpers";
import { computeBudgetStatus } from "@/lib/budget-helpers";
import { computeAchievements } from "@/lib/achievement-helpers";
import { useBudget } from "@/hooks/use-budget";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { CostTrendChart } from "@/components/dashboard/cost-trend-chart";
import { CacheRateChart } from "@/components/dashboard/cache-rate-chart";
import { IoRatioChart } from "@/components/dashboard/io-ratio-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { HeatmapHero } from "@/components/dashboard/heatmap-hero";
import { WeekdayWeekendChart } from "@/components/dashboard/weekday-weekend-chart";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { BudgetAlert } from "@/components/dashboard/budget-alert";
import { BudgetDialog } from "@/components/dashboard/budget-dialog";
import { SnapshotAlert } from "@/components/dashboard/snapshot-alert";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { periodToDateRange, periodLabel, getLocalToday, fillDateRange } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";
import type { DailyCostPoint, DailyCacheRate } from "@/lib/cost-helpers";
import type { DailyPoint } from "@/hooks/use-usage-data";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ChartTab = "tokens" | "cost";

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [chartTab, setChartTab] = useState<ChartTab>("tokens");
  const { from, to } = periodToDateRange(period, new Date().getTimezoneOffset());

  const { data, daily, sources, models, loading, error } = useUsageData({
    from,
    ...(to ? { to } : {}),
  });
  const yearData = useUsageData({ days: 365 });

  // Half-hour granularity fetch for weekday/weekend + streak analysis
  const halfHourData = useUsageData({
    from,
    ...(to ? { to } : {}),
    granularity: "half-hour",
  });
  // Half-hour granularity for achievements (needs 365 days of data)
  const yearHalfHourData = useUsageData({ days: 365, granularity: "half-hour" });

  const currentYear = new Date().getFullYear();
  const heatmapData = toHeatmapData(yearData.daily);

  const { pricingMap } = usePricingMap();

  // Timezone offset for UTC→local date conversion (used by multiple helpers)
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);
  const today = useMemo(() => getLocalToday(tzOffset), [tzOffset]);

  // Fill date gaps + extend to today so charts always show up to the current day
  const filledDaily = useMemo<DailyPoint[]>(
    () => fillDateRange(daily, "date", (d) => ({
      date: d, input: 0, output: 0, cached: 0, reasoning: 0, total: 0,
    }), today),
    [daily, today],
  );

  // Budget tracking — always fetch current month
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const { budget, saveBudget, deleteBudget } = useBudget(currentMonth);

  const estimatedCost = useMemo(() => computeTotalCost(models, pricingMap), [models, pricingMap]);

  const dailyCostPoints = useMemo(
    () => {
      if (!data) return [];
      const sparse = toDailyCostPoints(data.records, pricingMap, tzOffset);
      return fillDateRange<DailyCostPoint>(sparse, "date", (d) => ({
        date: d, inputCost: 0, outputCost: 0, cachedCost: 0, totalCost: 0,
      }), today);
    },
    [data, pricingMap, tzOffset, today],
  );

  const cacheSavings = useMemo(
    () => computeCacheSavings(models, pricingMap),
    [models, pricingMap],
  );

  const costForecast = useMemo(
    () => forecastMonthlyCost(dailyCostPoints),
    [dailyCostPoints],
  );

  // Budget status (only meaningful when budget exists + forecast available)
  const currentMonthTokens = useMemo(
    () => (yearHalfHourData.data ? computeCurrentMonthTokens(yearHalfHourData.data.records, undefined, tzOffset) : 0),
    [yearHalfHourData.data, tzOffset],
  );

  const budgetStatus = useMemo(() => {
    if (!budget || !costForecast) return null;
    if (budget.budget_usd === null && budget.budget_tokens === null) return null;
    return computeBudgetStatus(
      budget,
      costForecast.currentMonthCost,
      currentMonthTokens,
      costForecast,
    );
  }, [budget, costForecast, currentMonthTokens]);

  const dailyCacheRates = useMemo(
    () => {
      if (!data) return [];
      const sparse = toDailyCacheRates(data.records, tzOffset);
      return fillDateRange<DailyCacheRate>(sparse, "date", (d) => ({
        date: d, cacheRate: 0, cachedTokens: 0, inputTokens: 0,
      }), today);
    },
    [data, tzOffset, today],
  );

  // MoM growth (needs 2 months of data — use half-hour records)

  const mom = useMemo(
    () => (halfHourData.data ? computeMoMGrowth(halfHourData.data.records, pricingMap, undefined, tzOffset) : null),
    [halfHourData.data, pricingMap, tzOffset],
  );

  // Weekday vs weekend comparison
  const weekdayWeekend = useMemo(() => {
    if (!halfHourData.data) return null;
    const toStr = to ?? getLocalToday(tzOffset);
    return compareWeekdayWeekend(halfHourData.data.records, { from, to: toStr }, pricingMap, tzOffset);
  }, [halfHourData.data, from, to, pricingMap, tzOffset]);

  // Achievements (always 365-day scope)
  const achievements = useMemo(() => {
    if (!yearHalfHourData.data) return [];
    return computeAchievements({
      rows: yearHalfHourData.data.records,
      summary: yearHalfHourData.data.summary,
      models,
      pricingMap,
      tzOffset,
    });
  }, [yearHalfHourData.data, models, pricingMap, tzOffset]);

  // Streak data for HeatmapHero
  const streakInfo = useMemo(() => {
    if (!yearHalfHourData.data) return { currentStreak: 0, longestStreak: 0 };
    return computeStreak(yearHalfHourData.data.records, today, tzOffset);
  }, [yearHalfHourData.data, today, tzOffset]);

  // Active days count for HeatmapHero
  const activeDays = useMemo(() => {
    if (!yearHalfHourData.data) return 0;
    return toLocalDailyBuckets(yearHalfHourData.data.records, tzOffset).length;
  }, [yearHalfHourData.data, tzOffset]);

  // Year total tokens for HeatmapHero
  const yearTotalTokens = yearData.data?.summary.total_tokens ?? 0;

  const showForecast = (period === "month" || period === "all") && costForecast !== null;

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Admin alert: ended seasons without snapshot */}
      <SnapshotAlert />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Token usage overview for your AI coding tools.
            </p>
          </div>
           <BudgetDialog budget={budget} saveBudget={saveBudget} deleteBudget={deleteBudget} className="self-start mt-1" />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load usage data: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && <DashboardSkeleton />}

      {/* Empty state — no usage data yet */}
      {!loading && data && data.summary.total_tokens === 0 && (
        <DashboardEmptyState />
      )}

      {/* Content — only show when there's actual data */}
      {!loading && data && data.summary.total_tokens > 0 && (
        <>
          {/* ── Hero: Year Activity Heatmap + Achievements ────── */}
          <HeatmapHero
            data={heatmapData}
            year={currentYear}
            totalTokens={yearTotalTokens}
            currentStreak={streakInfo.currentStreak}
            longestStreak={streakInfo.longestStreak}
            activeDays={activeDays}
            achievements={achievements}
            loading={yearData.loading || yearHalfHourData.loading}
          />

          {/* ── Overview ────────────────────────────────────── */}
          <DashboardSegment title="Overview" action={<PeriodSelector value={period} onChange={setPeriod} />}>
            {/* Budget progress + alert (above stat grid when budget is active) */}
            {budgetStatus && <BudgetProgress status={budgetStatus} />}
            {budgetStatus && <BudgetAlert status={budgetStatus} />}

            {/* Row 1 — Core metrics (always 4 columns) */}
            <StatGrid columns={4}>
              <StatCard
                title="Total Tokens"
                value={formatTokens(data.summary.total_tokens)}
                subtitle={subtitle}
                icon={Zap}
                iconColor="text-primary"
                variant="primary"
                accentColor="bg-gradient-to-r from-primary to-chart-8"
                trends={mom ? [
                  ...(mom.previousMonthSameDate.tokens > 0 && mom.previousMonthSameDate.tokens !== mom.previousMonth.tokens
                    ? [{ value: Math.round(mom.sameDateTokenGrowth), label: "vs same period" }]
                    : []),
                  ...(mom.previousMonth.tokens > 0
                    ? [{ value: Math.round(mom.tokenGrowth), label: "vs last month" }]
                    : []),
                ] : undefined}
              />
              <StatCard
                title="Input Tokens"
                value={formatTokens(data.summary.input_tokens)}
                subtitle="Prompts & context"
                icon={ArrowDownToLine}
                accentColor="bg-chart-3"
              />
              <StatCard
                title="Output Tokens"
                value={formatTokens(data.summary.output_tokens)}
                subtitle="Responses & reasoning"
                icon={ArrowUpFromLine}
                accentColor="bg-chart-5"
              />
              <StatCard
                title="Est. Cost"
                value={formatCost(estimatedCost)}
                subtitle="Based on public pricing"
                icon={DollarSign}
                iconColor="text-chart-6"
                variant="primary"
                accentColor="bg-chart-6"
                trends={mom ? [
                  ...(mom.previousMonthSameDate.cost > 0 && mom.previousMonthSameDate.cost !== mom.previousMonth.cost
                    ? [{ value: -Math.round(mom.sameDateCostGrowth), label: "vs same period" }]
                    : []),
                  ...(mom.previousMonth.cost > 0
                    ? [{ value: -Math.round(mom.costGrowth), label: "vs last month" }]
                    : []),
                ] : undefined}
              />
            </StatGrid>

            {/* Row 2 — Economy metrics (4 cols with forecast, 2 cols without) */}
            <StatGrid columns={showForecast ? 4 : 2}>
              <StatCard
                title="Cache Savings"
                value={formatCost(cacheSavings.netSavings)}
                subtitle={`${Math.round(cacheSavings.savingsPercent)}% vs full input price`}
                icon={PiggyBank}
                iconColor="text-success"
              />
              <StatCard
                title="Cached Tokens"
                value={formatTokens(data.summary.cached_input_tokens)}
                subtitle={
                  data.summary.input_tokens > 0
                    ? `${Math.round((data.summary.cached_input_tokens / data.summary.input_tokens) * 100)}% hit rate`
                    : "0% hit rate"
                }
                icon={Database}
                iconColor="text-muted-foreground"
              />
              {showForecast && (
                <StatCard
                  title="Monthly Forecast"
                  value={formatCost(costForecast.projectedMonthCost)}
                  subtitle={`${formatCost(costForecast.currentMonthCost)} spent so far (${costForecast.daysElapsed} days)`}
                  icon={TrendingUp}
                  iconColor="text-chart-6"
                />
              )}
              {showForecast && (
                <StatCard
                  title="Daily Average"
                  value={formatCost(costForecast.dailyAverage)}
                  subtitle={`${costForecast.daysInMonth - costForecast.daysElapsed} days remaining`}
                  icon={DollarSign}
                  iconColor="text-muted-foreground"
                />
              )}
            </StatGrid>
          </DashboardSegment>

          {/* ── Trends ──────────────────────────────────────── */}
          <DashboardSegment title="Trends">
            {/* Charts — left: trends + cache, right: donut + io ratio */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
              {/* Left column */}
              <div className="flex flex-col gap-3 md:gap-4">
                <div>
                  {/* Tab toggle: Tokens | Cost */}
                  <div className="mb-3 flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
                    {(["tokens", "cost"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setChartTab(tab)}
                        className={cn(
                          "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                          chartTab === tab
                            ? "bg-secondary text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {tab === "tokens" ? "Tokens" : "Cost"}
                      </button>
                    ))}
                  </div>
                  {chartTab === "tokens" ? (
                    <UsageTrendChart data={filledDaily} />
                  ) : (
                    <CostTrendChart data={dailyCostPoints} />
                  )}
                </div>
                <CacheRateChart data={dailyCacheRates} />
              </div>

              {/* Right column — top spacer matches the tab toggle height so charts align */}
              <div className="flex flex-col gap-3 md:gap-4">
                {/* Invisible spacer matching the tab toggle row height (p-1 + text + mb-3) */}
                <div className="hidden lg:block h-[28px] shrink-0" />
                <SourceDonutChart data={sources} className="flex-1" />
                <IoRatioChart
                  inputTokens={data.summary.input_tokens}
                  outputTokens={data.summary.output_tokens}
                />
              </div>
            </div>
          </DashboardSegment>

          {/* ── Insights ────────────────────────────────────── */}
          {weekdayWeekend && (
            <DashboardSegment title="Insights">
              <WeekdayWeekendChart stats={weekdayWeekend} />
            </DashboardSegment>
          )}
        </>
      )}
    </div>
  );
}

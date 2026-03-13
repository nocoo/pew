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
import { compareWeekdayWeekend, computeMoMGrowth } from "@/lib/usage-helpers";
import { computeBudgetStatus } from "@/lib/budget-helpers";
import { computeAchievements } from "@/lib/achievement-helpers";
import { useBudget } from "@/hooks/use-budget";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { AchievementShelf } from "@/components/dashboard/achievement-shelf";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { CostTrendChart } from "@/components/dashboard/cost-trend-chart";
import { CacheRateChart } from "@/components/dashboard/cache-rate-chart";
import { IoRatioChart } from "@/components/dashboard/io-ratio-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { HeatmapCalendar } from "@/components/dashboard/heatmap-calendar";
import { WeekdayWeekendChart } from "@/components/dashboard/weekday-weekend-chart";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { BudgetAlert } from "@/components/dashboard/budget-alert";
import { BudgetDialog } from "@/components/dashboard/budget-dialog";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { periodToDateRange, periodLabel, getLocalToday } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";
import { Skeleton } from "@/components/ui/skeleton";

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

  // Budget tracking — always fetch current month
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const { budget, saveBudget, deleteBudget } = useBudget(currentMonth);

  const estimatedCost = useMemo(() => computeTotalCost(models, pricingMap), [models, pricingMap]);

  const dailyCostPoints = useMemo(
    () => (data ? toDailyCostPoints(data.records, pricingMap, tzOffset) : []),
    [data, pricingMap, tzOffset],
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
    () => (data ? toDailyCacheRates(data.records, tzOffset) : []),
    [data, tzOffset],
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

  const showForecast = (period === "month" || period === "all") && costForecast !== null;

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header + period selector */}
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
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load usage data: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && <DashboardSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {/* ── Achievements ────────────────────────────────── */}
          <DashboardSegment title="Achievements">
            <AchievementShelf achievements={achievements} />
          </DashboardSegment>

          {/* ── Overview ────────────────────────────────────── */}
          <DashboardSegment title="Overview">
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
                {...(mom && mom.previousMonth.tokens > 0
                  ? { trend: { value: Math.round(mom.tokenGrowth), label: "vs last month" } }
                  : {})}
              />
              <StatCard
                title="Input Tokens"
                value={formatTokens(data.summary.input_tokens)}
                subtitle="Prompts & context"
                icon={ArrowDownToLine}
              />
              <StatCard
                title="Output Tokens"
                value={formatTokens(data.summary.output_tokens)}
                subtitle="Responses & reasoning"
                icon={ArrowUpFromLine}
              />
              <StatCard
                title="Est. Cost"
                value={formatCost(estimatedCost)}
                subtitle="Based on public pricing"
                icon={DollarSign}
                iconColor="text-chart-6"
                {...(mom && mom.previousMonth.cost > 0
                  ? { trend: { value: -Math.round(mom.costGrowth), label: "vs last month" } }
                  : {})}
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
                    <UsageTrendChart data={daily} />
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
          <DashboardSegment title="Insights">
            {/* Activity heatmap + Weekday vs Weekend — side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
              <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
                <p className="mb-3 text-xs md:text-sm text-muted-foreground">
                  {currentYear} Activity
                </p>
                {yearData.loading ? (
                  <Skeleton className="h-[120px] w-full" />
                ) : (
                  <HeatmapCalendar
                    data={heatmapData}
                    year={currentYear}
                    valueFormatter={(v) => formatTokens(v)}
                  />
                )}
              </div>
              {weekdayWeekend && (
                <WeekdayWeekendChart stats={weekdayWeekend} />
              )}
            </div>
          </DashboardSegment>
        </>
      )}
    </div>
  );
}

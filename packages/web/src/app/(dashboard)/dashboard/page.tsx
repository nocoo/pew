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
import { computeTotalCost, toDailyCostPoints, computeCacheSavings, forecastMonthlyCost, toDailyCacheRates } from "@/lib/cost-helpers";
import { compareWeekdayWeekend, computeMoMGrowth, computeStreak } from "@/lib/usage-helpers";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { CostTrendChart } from "@/components/dashboard/cost-trend-chart";
import { CacheRateChart } from "@/components/dashboard/cache-rate-chart";
import { IoRatioChart } from "@/components/dashboard/io-ratio-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { HeatmapCalendar } from "@/components/dashboard/heatmap-calendar";
import { WeekdayWeekendChart } from "@/components/dashboard/weekday-weekend-chart";
import { StreakBadge } from "@/components/dashboard/streak-badge";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { periodToDateRange, periodLabel } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ChartTab = "tokens" | "cost";

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [chartTab, setChartTab] = useState<ChartTab>("tokens");
  const { from, to } = periodToDateRange(period);

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
  // Half-hour granularity for streak (needs 365 days of data)
  const yearHalfHourData = useUsageData({ days: 365, granularity: "half-hour" });

  const currentYear = new Date().getFullYear();
  const heatmapData = toHeatmapData(yearData.daily);

  const { pricingMap } = usePricingMap();

  const estimatedCost = useMemo(() => computeTotalCost(models, pricingMap), [models, pricingMap]);

  const dailyCostPoints = useMemo(
    () => (data ? toDailyCostPoints(data.records, pricingMap) : []),
    [data, pricingMap],
  );

  const cacheSavings = useMemo(
    () => computeCacheSavings(models, pricingMap),
    [models, pricingMap],
  );

  const costForecast = useMemo(
    () => forecastMonthlyCost(dailyCostPoints),
    [dailyCostPoints],
  );

  const dailyCacheRates = useMemo(
    () => (data ? toDailyCacheRates(data.records) : []),
    [data],
  );

  // MoM growth (needs 2 months of data — use half-hour records)
  const tzOffset = useMemo(() => new Date().getTimezoneOffset(), []);

  const mom = useMemo(
    () => (halfHourData.data ? computeMoMGrowth(halfHourData.data.records, pricingMap) : null),
    [halfHourData.data, pricingMap],
  );

  // Weekday vs weekend comparison
  const weekdayWeekend = useMemo(() => {
    if (!halfHourData.data) return null;
    const toStr = to ?? new Date().toISOString().slice(0, 10);
    return compareWeekdayWeekend(halfHourData.data.records, { from, to: toStr }, pricingMap, tzOffset);
  }, [halfHourData.data, from, to, pricingMap, tzOffset]);

  // Usage streak (365 days, half-hour granularity)
  const streak = useMemo(
    () => (yearHalfHourData.data ? computeStreak(yearHalfHourData.data.records, undefined, tzOffset) : null),
    [yearHalfHourData.data, tzOffset],
  );

  const showForecast = (period === "month" || period === "all") && costForecast !== null;

  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header + period selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Token usage overview for your AI coding tools.
          </p>
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
          {/* Stat cards */}
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
              title="Est. Cost"
              value={formatCost(estimatedCost)}
              subtitle="Based on public pricing"
              icon={DollarSign}
              iconColor="text-chart-6"
              {...(mom && mom.previousMonth.cost > 0
                ? { trend: { value: -Math.round(mom.costGrowth), label: "vs last month" } }
                : {})}
            />
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
          </StatGrid>

          {/* Cost forecast (only when period is month or all, and enough data) */}
          {showForecast && (
            <StatGrid columns={2}>
              <StatCard
                title="Monthly Forecast"
                value={formatCost(costForecast.projectedMonthCost)}
                subtitle={`${formatCost(costForecast.currentMonthCost)} spent so far (${costForecast.daysElapsed} days)`}
                icon={TrendingUp}
                iconColor="text-chart-6"
              />
              <StatCard
                title="Daily Average"
                value={formatCost(costForecast.dailyAverage)}
                subtitle={`${costForecast.daysInMonth - costForecast.daysElapsed} days remaining`}
                icon={DollarSign}
                iconColor="text-muted-foreground"
              />
            </StatGrid>
          )}

          {/* Token breakdown (secondary row) */}
          <StatGrid columns={3}>
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
              title="Cached Tokens"
              value={formatTokens(data.summary.cached_input_tokens)}
              subtitle="Cache hits"
              icon={Database}
            />
          </StatGrid>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
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
            <div className="flex flex-col gap-3 md:gap-4">
              <SourceDonutChart data={sources} />
              <IoRatioChart
                inputTokens={data.summary.input_tokens}
                outputTokens={data.summary.output_tokens}
              />
            </div>
          </div>

          {/* Efficiency row: cache rate trend */}
          <CacheRateChart data={dailyCacheRates} />

          {/* Insights row: weekday vs weekend */}
          {weekdayWeekend && (
            <WeekdayWeekendChart stats={weekdayWeekend} />
          )}

          {/* Activity heatmap + streak */}
          <div className="space-y-3">
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
            {streak && <StreakBadge streak={streak} />}
          </div>
        </>
      )}
    </div>
  );
}

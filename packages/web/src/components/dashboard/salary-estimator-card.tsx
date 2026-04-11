"use client";

import { useState, useMemo, createContext, useContext } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Banknote, ExternalLink, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { chart, chartAxis, chartMuted } from "@/lib/palette";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyCostWithRatio {
  date: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
}

type TimeRange = "7d" | "30d" | "all";

interface RangeOption {
  value: TimeRange;
  label: string;
}

const RANGE_OPTIONS: RangeOption[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

// Upper/lower bound multipliers for salary range
// Based on typical I/O ratio variance: more output = higher cost = higher implied salary
// Actual cost already reflects real I/O ratio, so we apply a ±30% range
const LOWER_BOUND_MULTIPLIER = 0.7; // 70% of actual (if I/O ratio were more favorable)
const UPPER_BOUND_MULTIPLIER = 1.3; // 130% of actual (if I/O ratio were less favorable)

// ---------------------------------------------------------------------------
// Context for sharing slider state between card and chart
// ---------------------------------------------------------------------------

interface SalaryEstimatorContextValue {
  huangRatio: number;
  setHuangRatio: (v: number) => void;
  priceMultiplier: number;
  setPriceMultiplier: (v: number) => void;
}

const SalaryEstimatorContext = createContext<SalaryEstimatorContextValue | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format salary with appropriate suffix (K, M) and no decimals for large values.
 */
function formatSalary(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}K`;
  }
  return `$${Math.round(value).toLocaleString()}`;
}

/**
 * Format cost with 2 decimal places for small values.
 */
function formatCostDisplay(value: number): string {
  if (value < 1) return `$${value.toFixed(2)}`;
  if (value < 100) return `$${value.toFixed(1)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

/**
 * Calculate yearly salary from daily cost.
 */
function dailyCostToYearlySalary(
  dailyCost: number,
  huangRatio: number,
  priceMultiplier: number
): number {
  const adjustedCost = dailyCost * (priceMultiplier / 100);
  const ratio = huangRatio / 100;
  if (ratio === 0) return 0;
  return (adjustedCost * 365) / ratio;
}

/** Format date string "2026-03-07" to "Mar 7" */
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// SalaryEstimatorCard (left side with sliders)
// ---------------------------------------------------------------------------

interface SalaryEstimatorCardProps {
  dailyAvgCost: number;
  rangeLabel: string;
  className?: string;
}

function SalaryEstimatorCard({
  dailyAvgCost,
  rangeLabel,
  className,
}: SalaryEstimatorCardProps) {
  const ctx = useContext(SalaryEstimatorContext);
  if (!ctx) throw new Error("SalaryEstimatorCard must be used within SalaryEstimator");

  const { huangRatio, setHuangRatio, priceMultiplier, setPriceMultiplier } = ctx;

  const adjustedDailyCost = dailyAvgCost * (priceMultiplier / 100);

  const salaries = useMemo(() => {
    const ratio = huangRatio / 100;
    if (ratio === 0) {
      return { weekly: 0, monthly: 0, yearly: 0 };
    }

    const yearlyCost = adjustedDailyCost * 365;
    const yearly = yearlyCost / ratio;
    const monthly = yearly / 12;
    const weekly = yearly / 52;

    return { weekly, monthly, yearly };
  }, [adjustedDailyCost, huangRatio]);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 flex flex-col",
        className
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-card p-2 text-primary">
            <Banknote className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Salary Estimator
            </p>
            <p className="text-xs text-muted-foreground">
              Based on {rangeLabel} token usage
            </p>
          </div>
        </div>
      </div>

      {/* Salary Display */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <SalaryDisplay label="Weekly" value={salaries.weekly} />
        <SalaryDisplay label="Monthly" value={salaries.monthly} highlight />
        <SalaryDisplay label="Yearly" value={salaries.yearly} />
      </div>

      {/* Sliders */}
      <div className="space-y-4">
        <SliderControl
          label="Huang Ratio"
          value={huangRatio}
          onChange={setHuangRatio}
          min={10}
          max={100}
          step={5}
          formatValue={(v) => `${v}%`}
          description="Token spend as % of salary"
          defaultValue={50}
        />
        <SliderControl
          label="Price Adjustment"
          value={priceMultiplier}
          onChange={setPriceMultiplier}
          min={10}
          max={300}
          step={10}
          formatValue={(v) => `${v}%`}
          description="Adjust for future price changes"
          defaultValue={100}
        />
      </div>

      {/* Info Section */}
      <div className="mt-5 space-y-2 border-t border-border/40 pt-4">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <p>
            <strong>Huang&apos;s 50% Theory:</strong> Jensen Huang suggests a $500K
            engineer should consume $250K in AI tokens yearly.{" "}
            <a
              href="https://www.youtube.com/watch?v=tcwV0TFTPBI"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              Watch interview
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </p>
        </div>
        <div className="flex items-start gap-2 text-xs text-muted-foreground/70">
          <Info className="mt-0.5 h-3 w-3 shrink-0 opacity-0" />
          <p>
            Note: Inference costs are dropping rapidly. Today&apos;s token spend may
            represent higher &quot;effective salary&quot; as prices decrease over time.
          </p>
        </div>
      </div>

      {/* Daily Cost Reference */}
      <div className="mt-auto pt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>Daily avg cost ({rangeLabel})</span>
        <span className="font-medium tabular-nums text-foreground">
          {formatCostDisplay(adjustedDailyCost)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SalaryTrendChart (right side)
// ---------------------------------------------------------------------------

interface SalaryTrendChartProps {
  data: DailyCostWithRatio[];
  className?: string;
}

function SalaryTrendChart({ data, className }: SalaryTrendChartProps) {
  const ctx = useContext(SalaryEstimatorContext);
  if (!ctx) throw new Error("SalaryTrendChart must be used within SalaryEstimator");

  const { huangRatio, priceMultiplier } = ctx;

  const chartData = useMemo(() => {
    return data.map((d) => {
      // Use actual cost for the "actual" line
      const actualSalary = dailyCostToYearlySalary(d.totalCost, huangRatio, priceMultiplier);

      // Upper/lower bounds are ±30% of actual salary
      // This reflects variance from different I/O ratios and model choices
      const lowerSalary = actualSalary * LOWER_BOUND_MULTIPLIER;
      const upperSalary = actualSalary * UPPER_BOUND_MULTIPLIER;

      return {
        date: d.date,
        actual: actualSalary,
        lower: lowerSalary,
        upper: upperSalary,
      };
    });
  }, [data, huangRatio, priceMultiplier]);

  if (chartData.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No data for salary trend
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 flex flex-col",
        className
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          Salary Trend
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-3 rounded-full" style={{ background: chart.violet }} />
            <span className="text-xs text-muted-foreground">Actual</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-0.5 w-3 rounded-full"
              style={{ background: chartMuted, opacity: 0.6 }}
            />
            <span className="text-xs text-muted-foreground">Range</span>
          </div>
        </div>
      </div>

      {/* Chart fills remaining height */}
      <div className="flex-1 min-h-0">
        <DashboardResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
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
              tickFormatter={formatSalary}
              tick={{ fill: chartAxis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              content={<SalaryTooltip />}
              isAnimationActive={false}
            />
            {/* Upper bound (dashed) */}
            <Line
              type="monotone"
              dataKey="upper"
              stroke={chartMuted}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              strokeOpacity={0.6}
            />
            {/* Actual (solid) */}
            <Line
              type="monotone"
              dataKey="actual"
              stroke={chart.violet}
              strokeWidth={2}
              dot={false}
            />
            {/* Lower bound (dashed) */}
            <Line
              type="monotone"
              dataKey="lower"
              stroke={chartMuted}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              strokeOpacity={0.6}
            />
          </LineChart>
        </DashboardResponsiveContainer>
      </div>
    </div>
  );
}

function SalaryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labels: Record<string, string> = {
    actual: "Actual",
    upper: "Upper Bound",
    lower: "Lower Bound",
  };

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {["actual", "upper", "lower"].map((key) => {
        const entry = payload.find((e) => e.dataKey === key);
        if (!entry) return null;
        return (
          <ChartTooltipRow
            key={key}
            color={key === "actual" ? chart.violet : chartMuted}
            label={labels[key] ?? key}
            value={`${formatSalary(entry.value)}/yr`}
            tabularNums
          />
        );
      })}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SalaryDisplay({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg p-3 text-center",
        highlight ? "bg-card" : "bg-muted/30"
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-display font-semibold tabular-nums tracking-tight",
          highlight ? "text-xl text-foreground" : "text-lg text-foreground/80"
        )}
      >
        {formatSalary(value)}
      </p>
    </div>
  );
}

function SliderControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
  formatValue,
  description,
  defaultValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  description: string;
  defaultValue: number;
}) {
  const isDefault = value === defaultValue;
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{label}</span>
          <span
            className={cn(
              "rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-opacity",
              isDefault ? "opacity-100" : "opacity-0"
            )}
          >
            Default
          </span>
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">
          {formatValue(value)}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="slider-input w-full"
          style={
            {
              "--slider-pct": `${pct}%`,
            } as React.CSSProperties
          }
        />
      </div>
      <p className="text-[10px] text-muted-foreground/70">{description}</p>

      <style jsx>{`
        .slider-input {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(
            to right,
            hsl(var(--primary)) 0%,
            hsl(var(--primary)) var(--slider-pct),
            hsl(var(--muted)) var(--slider-pct),
            hsl(var(--muted)) 100%
          );
          cursor: pointer;
        }

        .slider-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: hsl(var(--primary));
          border: 2px solid hsl(var(--background));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          cursor: pointer;
          transition: transform 0.1s ease;
        }

        .slider-input::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }

        .slider-input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: hsl(var(--primary));
          border: 2px solid hsl(var(--background));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          cursor: pointer;
        }

        .slider-input:focus {
          outline: none;
        }

        .slider-input:focus::-webkit-slider-thumb {
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.2);
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data computation
// ---------------------------------------------------------------------------

interface SalaryEstimatorData {
  ranges: {
    "7d": { dailyAvg: number; days: number };
    "30d": { dailyAvg: number; days: number };
    all: { dailyAvg: number; days: number };
  };
}

export function computeSalaryEstimatorData(
  dailyCosts: Array<{ date: string; totalCost: number }>
): SalaryEstimatorData {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const filterByDays = (days: number) => {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return dailyCosts.filter(
      (d) => d.date >= cutoffStr && d.date <= todayStr
    );
  };

  const last7 = filterByDays(7);
  const last30 = filterByDays(30);

  const sum = (arr: typeof dailyCosts) =>
    arr.reduce((acc, d) => acc + d.totalCost, 0);

  return {
    ranges: {
      "7d": {
        dailyAvg: last7.length > 0 ? sum(last7) / Math.min(7, last7.length) : 0,
        days: last7.length,
      },
      "30d": {
        dailyAvg: last30.length > 0 ? sum(last30) / Math.min(30, last30.length) : 0,
        days: last30.length,
      },
      all: {
        dailyAvg:
          dailyCosts.length > 0 ? sum(dailyCosts) / dailyCosts.length : 0,
        days: dailyCosts.length,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Main Wrapper Component
// ---------------------------------------------------------------------------

interface SalaryEstimatorProps {
  /** Daily cost points with token breakdown */
  dailyCosts: Array<{
    date: string;
    totalCost: number;
    inputCost?: number;
    outputCost?: number;
  }>;
  /** Daily token breakdown for ratio calculation */
  dailyTokens?: Array<{
    date: string;
    input: number;
    output: number;
  }>;
  className?: string;
}

export function SalaryEstimator({
  dailyCosts,
  dailyTokens,
  className,
}: SalaryEstimatorProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [huangRatio, setHuangRatio] = useState(50);
  const [priceMultiplier, setPriceMultiplier] = useState(100);

  const data = useMemo(
    () => computeSalaryEstimatorData(dailyCosts),
    [dailyCosts]
  );

  // Merge cost and token data for the chart
  const chartData = useMemo<DailyCostWithRatio[]>(() => {
    const tokenMap = new Map<string, { input: number; output: number }>();
    if (dailyTokens) {
      for (const t of dailyTokens) {
        tokenMap.set(t.date, { input: t.input, output: t.output });
      }
    }

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Filter by selected time range
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 365;
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    return dailyCosts
      .filter((d) => d.date >= cutoffStr && d.date <= todayStr)
      .map((d) => {
        const tokens = tokenMap.get(d.date);
        return {
          date: d.date,
          totalCost: d.totalCost,
          inputTokens: tokens?.input ?? 0,
          outputTokens: tokens?.output ?? 0,
        };
      });
  }, [dailyCosts, dailyTokens, timeRange]);

  const currentRange = data.ranges[timeRange];
  const rangeLabel =
    timeRange === "7d"
      ? "last 7 days"
      : timeRange === "30d"
        ? "last 30 days"
        : "all time";

  const contextValue = useMemo(
    () => ({ huangRatio, setHuangRatio, priceMultiplier, setPriceMultiplier }),
    [huangRatio, priceMultiplier]
  );

  return (
    <SalaryEstimatorContext.Provider value={contextValue}>
      <div className={cn("space-y-3", className)}>
        {/* Time Range Selector */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTimeRange(opt.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                timeRange === opt.value
                  ? "bg-secondary text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Two-column layout: Card (50%) + Chart (50%) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
          <SalaryEstimatorCard
            dailyAvgCost={currentRange.dailyAvg}
            rangeLabel={rangeLabel}
          />
          <SalaryTrendChart data={chartData} />
        </div>
      </div>
    </SalaryEstimatorContext.Provider>
  );
}

"use client";

import { useState, useMemo } from "react";
import { Banknote, ExternalLink, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SalaryEstimatorCardProps {
  /** Daily average cost in USD */
  dailyAvgCost: number;
  /** Time range label for context */
  rangeLabel: string;
  className?: string;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Salary Estimator Card — estimates engineer salary based on token consumption.
 *
 * Based on Jensen Huang's "50% theory": a $500K/year engineer should consume
 * $250K/year in AI tokens. This card lets users adjust the ratio and token
 * price multiplier to estimate their equivalent salary.
 */
export function SalaryEstimatorCard({
  dailyAvgCost,
  rangeLabel,
  className,
}: SalaryEstimatorCardProps) {
  // Slider states
  const [huangRatio, setHuangRatio] = useState(50); // % of salary spent on tokens
  const [priceMultiplier, setPriceMultiplier] = useState(100); // % of current pricing

  // Calculations
  const adjustedDailyCost = dailyAvgCost * (priceMultiplier / 100);

  const salaries = useMemo(() => {
    // token_cost = salary * (huangRatio / 100)
    // salary = token_cost / (huangRatio / 100)
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
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
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
        {/* Huang Ratio Slider */}
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

        {/* Price Multiplier Slider */}
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
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>Daily avg cost ({rangeLabel})</span>
        <span className="font-medium tabular-nums text-foreground">
          {formatCostDisplay(adjustedDailyCost)}
        </span>
      </div>
    </div>
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
          {/* Always render badge container to prevent layout shift */}
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

      {/* Slider custom styles */}
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
// Hook: useSalaryEstimatorData
// ---------------------------------------------------------------------------

interface SalaryEstimatorData {
  /** Daily average cost for each time range */
  ranges: {
    "7d": { dailyAvg: number; days: number };
    "30d": { dailyAvg: number; days: number };
    all: { dailyAvg: number; days: number };
  };
}

/**
 * Compute daily average costs for different time ranges.
 */
export function computeSalaryEstimatorData(
  dailyCosts: Array<{ date: string; totalCost: number }>
): SalaryEstimatorData {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Helper to filter costs by days ago
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
// Wrapper component with time range selector
// ---------------------------------------------------------------------------

interface SalaryEstimatorProps {
  dailyCosts: Array<{ date: string; totalCost: number }>;
  className?: string;
}

export function SalaryEstimator({ dailyCosts, className }: SalaryEstimatorProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");

  const data = useMemo(
    () => computeSalaryEstimatorData(dailyCosts),
    [dailyCosts]
  );

  const currentRange = data.ranges[timeRange];
  const rangeLabel =
    timeRange === "7d"
      ? "last 7 days"
      : timeRange === "30d"
        ? "last 30 days"
        : "all time";

  return (
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

      <SalaryEstimatorCard
        dailyAvgCost={currentRange.dailyAvg}
        rangeLabel={rangeLabel}
      />
    </div>
  );
}

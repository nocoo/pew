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
import { Badge } from "@nocoo/basalt/components/badge";
import { Slider } from "@nocoo/basalt/components/slider";
import { Button } from "@nocoo/basalt/components/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@nocoo/basalt/components/dialog";
import { Banknote, ExternalLink, Info, Settings, X } from "lucide-react";
import { rowIconClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { chart, chartAxis, chartMuted } from "@/lib/palette";
import { DashboardResponsiveContainer } from "./dashboard-responsive-container";
import { ChartTooltip, ChartTooltipRow } from "./chart-tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailySalaryCost {
  date: string;
  totalCost: number;
}

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
  const d = new Date(`${dateStr}T00:00:00Z`);
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
  if (!ctx) throw new Error("SalaryEstimatorCard must be used within SalaryCalculatorCard");

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
        "rounded-card bg-secondary p-4 md:p-5 flex flex-col",
        className
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-background p-2 text-primary">
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
  data: DailySalaryCost[];
  compact?: boolean;
  className?: string;
}

function SalaryTrendChart({ data, compact = false, className }: SalaryTrendChartProps) {
  const ctx = useContext(SalaryEstimatorContext);
  if (!ctx) throw new Error("SalaryTrendChart must be used within SalaryCalculatorCard");

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
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
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
        "min-w-0 flex flex-col",
        !compact && "rounded-card bg-secondary p-4 md:p-5",
        className
      )}
    >
      {/* Header */}
      <div className={cn("flex items-center justify-between", compact ? "mb-2" : "mb-3")}>
        <p className={cn("text-xs text-muted-foreground", !compact && "md:text-sm")}>
          Salary Trend
        </p>
        {compact ? <span className="text-xs text-muted-foreground">Annualized</span> : <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-3 rounded-full" style={{ background: chart.violet }} />
            <span className="text-xs text-muted-foreground">Estimated</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-0.5 w-3 rounded-full"
              style={{ background: chartMuted, opacity: 0.6 }}
            />
            <span className="text-xs text-muted-foreground">Range</span>
          </div>
        </div>}
      </div>

      {/* Chart fills remaining height */}
      <div className={compact ? "h-[140px] @[640px]:h-[90px]" : "min-h-[260px] flex-1"}>
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
              hide={compact}
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
              isAnimationActive={false}
            />
            {/* Actual (solid) */}
            <Line
              type="monotone"
              dataKey="actual"
              stroke={chart.violet}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
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
              isAnimationActive={false}
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
    actual: "Estimated",
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
        highlight ? "bg-secondary" : "bg-muted/30"
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{label}</span>
          <Badge
            variant="info"
            className={cn(
              "transition-opacity",
              isDefault ? "opacity-100" : "opacity-0"
            )}
          >
            Default
          </Badge>
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">
          {formatValue(value)}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(values) => {
          const next = values[0];
          if (next !== undefined) onChange(next);
        }}
        aria-label={label}
      />
      <p className="text-[10px] text-muted-foreground/70">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wrapper Component
// ---------------------------------------------------------------------------

interface SalaryCalculatorCardProps {
  /** Use the same selected period and calendar-day average as Overview. */
  rangeLabel: string;
  dailyAverageCost: number;
  dailyCosts: DailySalaryCost[];
  incomplete: boolean;
  disabled: boolean;
  className?: string;
}

export function SalaryCalculatorCard({
  rangeLabel,
  dailyAverageCost,
  dailyCosts,
  incomplete,
  disabled,
  className,
}: SalaryCalculatorCardProps) {
  const [huangRatio, setHuangRatio] = useState(50);
  const [priceMultiplier, setPriceMultiplier] = useState(100);
  const yearlySalary = dailyCostToYearlySalary(dailyAverageCost, huangRatio, priceMultiplier);

  const contextValue = useMemo(
    () => ({ huangRatio, setHuangRatio, priceMultiplier, setPriceMultiplier }),
    [huangRatio, priceMultiplier]
  );

  return (
    <SalaryEstimatorContext.Provider value={contextValue}>
      <Dialog>
        <section aria-label="Salary calculator" className={cn("@container min-w-0 rounded-card bg-secondary p-4 flex flex-col", className)}>
          <div className="mb-3 flex min-h-12 items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Banknote className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="text-xs font-medium uppercase tracking-wider">Salary Calculator</span>
              </div>
              <p className="text-xs text-muted-foreground">{rangeLabel} · {dailyCosts.length} days</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="text-right">
                <output aria-label="Monthly salary equivalent" className="block font-display text-2xl font-bold tracking-tight">{disabled ? "—" : formatSalary(yearlySalary / 12)}</output>
                <p className="text-xs text-muted-foreground">/ month</p>
              </div>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className={rowIconClassName} disabled={disabled} aria-label="Salary settings">
                  <Settings strokeWidth={1.5} />
                </Button>
              </DialogTrigger>
            </div>
          </div>
          <div className="flex-1">
            {disabled ? <div className="flex h-[170px] items-center justify-center text-sm text-muted-foreground">Salary estimate unavailable</div>
              : <SalaryTrendChart data={dailyCosts} compact />}
          </div>
          <div className="mt-3 border-t border-border/50 pt-3">
            <dl className="grid grid-cols-3 gap-3 text-xs">
              {[
                ["Weekly", formatSalary(yearlySalary / 52)],
                ["Yearly", formatSalary(yearlySalary)],
                ["Daily cost", formatCostDisplay(dailyAverageCost * priceMultiplier / 100)],
              ].map(([label, value]) => <div key={label} className="@[640px]:flex @[640px]:items-baseline @[640px]:gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-medium tabular-nums">{disabled ? "—" : value}</dd>
              </div>)}
            </dl>
            <p className="mt-2 text-[10px] text-muted-foreground">{incomplete ? "Salary equivalent · incomplete price details" : "Salary equivalent based on estimated token spend"}</p>
          </div>
        </section>
        <DialogContent size="xl" className="sm:w-[72rem] p-4 sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-3">
            <DialogHeader>
              <DialogTitle>Salary settings</DialogTitle>
              <DialogDescription className="text-sm">
                {rangeLabel} · {dailyCosts.length} calendar days. Explore a salary equivalent from your estimated token spend. Adjustments apply immediately.
              </DialogDescription>
            </DialogHeader>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close salary settings" className="shrink-0"><X className="h-4 w-4" aria-hidden="true" /></Button>
            </DialogClose>
          </div>
          {incomplete && <p className="mb-4 text-xs text-muted-foreground">The underlying public-price estimate includes assumptions where cache or pricing details are unavailable.</p>}
          <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2">
            <SalaryEstimatorCard dailyAvgCost={dailyAverageCost} rangeLabel={rangeLabel} />
            <SalaryTrendChart data={dailyCosts} />
          </div>
        </DialogContent>
      </Dialog>
    </SalaryEstimatorContext.Provider>
  );
}

"use client";

/**
 * Budget progress bar — shows current spend vs budget limit.
 *
 * Horizontal progress bar inside a StatCard-like container.
 * Color: green (0–70%), yellow (70–90%), red (90%+).
 * Label: "$42.30 / $100.00 (42%)"
 * Projected line marker on the bar showing where the month will end.
 */

import { DollarSign, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/pricing";
import { formatTokens } from "@/lib/utils";
import type { BudgetStatus } from "@/lib/budget-helpers";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BudgetProgressProps {
  status: BudgetStatus;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick Tailwind color class based on usage percent. */
function barColor(pct: number): string {
  if (pct >= 90) return "bg-destructive";
  if (pct >= 70) return "bg-warning";
  return "bg-success";
}

/** Pick text color class based on usage percent. */
function textColor(pct: number): string {
  if (pct >= 90) return "text-destructive";
  if (pct >= 70) return "text-warning";
  return "text-success";
}

// ---------------------------------------------------------------------------
// ProgressRow — single row with label, bar, and projected marker
// ---------------------------------------------------------------------------

interface ProgressRowProps {
  label: string;
  icon: typeof DollarSign;
  spent: string;
  limit: string;
  percent: number;
  projectedPercent: number | null; // null if no projection available
}

function ProgressRow({
  label,
  icon: Icon,
  spent,
  limit,
  percent,
  projectedPercent,
}: ProgressRowProps) {
  // Clamp bar to 100% visual width but allow percent number to exceed
  const barWidth = Math.min(percent, 100);
  const projectedWidth =
    projectedPercent !== null ? Math.min(projectedPercent, 100) : null;

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("rounded-md bg-card p-1.5", textColor(percent))}>
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <span className="text-xs md:text-sm text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className={cn("font-semibold font-display", textColor(percent))}>
            {spent}
          </span>
          <span className="text-muted-foreground">/ {limit}</span>
          <span className={cn("text-xs font-medium", textColor(percent))}>
            ({percent === Infinity ? "∞" : `${Math.min(percent, 999)}%`})
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {/* Filled portion */}
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500", barColor(percent))}
          style={{ width: `${barWidth}%` }}
        />

        {/* Projected end-of-month marker */}
        {projectedWidth !== null && projectedWidth > barWidth && (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/40"
            style={{ left: `${projectedWidth}%` }}
            title={`Projected: ${projectedPercent === Infinity ? "∞" : `${Math.round(projectedPercent ?? 0)}%`}`}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BudgetProgress
// ---------------------------------------------------------------------------

export function BudgetProgress({ status, className }: BudgetProgressProps) {
  const hasUsd = status.budgetUsd !== null;
  const hasTokens = status.budgetTokens !== null;

  // Nothing to show if no budgets are set
  if (!hasUsd && !hasTokens) return null;

  // Compute projected percentages
  const projectedPercentUsd =
    hasUsd && (status.budgetUsd as number) > 0
      ? Math.round((status.projectedUsd / (status.budgetUsd as number)) * 100)
      : null;

  const projectedPercentTokens =
    hasTokens && (status.budgetTokens as number) > 0
      ? Math.round((status.projectedTokens / (status.budgetTokens as number)) * 100)
      : null;

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-4",
        className,
      )}
    >
      {hasUsd && (
        <ProgressRow
          label="Cost Budget"
          icon={DollarSign}
          spent={formatCost(status.spentUsd)}
          limit={formatCost(status.budgetUsd as number)}
          percent={status.usedPercentUsd}
          projectedPercent={projectedPercentUsd}
        />
      )}

      {hasTokens && (
        <ProgressRow
          label="Token Budget"
          icon={Coins}
          spent={formatTokens(status.spentTokens)}
          limit={formatTokens(status.budgetTokens as number)}
          percent={status.usedPercentTokens}
          projectedPercent={projectedPercentTokens}
        />
      )}
    </div>
  );
}

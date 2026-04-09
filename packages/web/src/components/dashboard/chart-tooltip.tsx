"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ChartTooltip — unified tooltip wrapper for all Recharts charts
// ---------------------------------------------------------------------------

interface ChartTooltipProps {
  /** Optional title displayed at the top of the tooltip */
  title?: string | undefined;
  /** Tooltip content (rows, dividers, etc.) */
  children: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Unified tooltip container for Recharts charts.
 *
 * Features:
 * - Consistent styling across all charts
 * - Shadow and ring for visual prominence
 * - Dark mode support via CSS variables
 * - 12px (text-xs) base font size
 */
export function ChartTooltip({ title, children, className }: ChartTooltipProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-widget)] bg-popover p-2.5 shadow-lg ring-1 ring-border/50",
        className
      )}
    >
      {title && (
        <p className="mb-1.5 text-xs font-medium text-popover-foreground">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChartTooltipRow — a single data row with color indicator
// ---------------------------------------------------------------------------

interface ChartTooltipRowProps {
  /** Color for the indicator dot */
  color: string;
  /** Label text (e.g., "Input", "Output") */
  label: string;
  /** Formatted value (e.g., "1.2M", "$4.50") */
  value: string;
  /** Use tabular-nums for numeric alignment */
  tabularNums?: boolean;
}

/**
 * A single row in the chart tooltip showing color indicator, label, and value.
 */
export function ChartTooltipRow({
  color,
  label,
  value,
  tabularNums = false,
}: ChartTooltipRowProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "ml-auto font-medium text-popover-foreground",
          tabularNums && "tabular-nums"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChartTooltipDivider — horizontal separator
// ---------------------------------------------------------------------------

/**
 * A subtle horizontal divider for separating sections in the tooltip.
 */
export function ChartTooltipDivider() {
  return <div className="my-1 border-b border-border/50" />;
}

// ---------------------------------------------------------------------------
// ChartTooltipSummary — summary row (e.g., Total)
// ---------------------------------------------------------------------------

interface ChartTooltipSummaryProps {
  /** Label text (e.g., "Total") */
  label: string;
  /** Formatted value */
  value: string;
}

/**
 * A summary row with divider, typically used for totals.
 */
export function ChartTooltipSummary({ label, value }: ChartTooltipSummaryProps) {
  return (
    <>
      <ChartTooltipDivider />
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-auto font-medium text-popover-foreground">
          {value}
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ChartTooltipSubtitle — secondary info line
// ---------------------------------------------------------------------------

interface ChartTooltipSubtitleProps {
  children: React.ReactNode;
}

/**
 * A subtitle line for additional context (e.g., source info).
 */
export function ChartTooltipSubtitle({ children }: ChartTooltipSubtitleProps) {
  return (
    <p className="mb-1 text-xs text-muted-foreground">{children}</p>
  );
}

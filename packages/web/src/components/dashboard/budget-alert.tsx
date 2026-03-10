"use client";

/**
 * Budget overage warning banner.
 *
 * Appears when projected spend will exceed budget by end of month.
 * Dismissible per session via local state (reappears on next page load).
 */

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/pricing";
import { formatTokens } from "@/lib/utils";
import type { BudgetStatus } from "@/lib/budget-helpers";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BudgetAlertProps {
  status: BudgetStatus;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BudgetAlert({ status, className }: BudgetAlertProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const messages: string[] = [];

  // USD overage warning
  if (status.willExceedUsd && status.budgetUsd !== null) {
    messages.push(
      `At current pace, you'll reach ${formatCost(status.projectedUsd)} by month end (budget: ${formatCost(status.budgetUsd)})`,
    );
  }

  // Token overage warning
  if (status.willExceedTokens && status.budgetTokens !== null) {
    messages.push(
      `Token usage projected to reach ${formatTokens(status.projectedTokens)} by month end (limit: ${formatTokens(status.budgetTokens)})`,
    );
  }

  if (messages.length === 0) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius-card)] bg-warning/10 p-4 text-sm text-warning",
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
      <div className="flex-1 space-y-1">
        {messages.map((msg) => (
          <p key={msg}>{msg}</p>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md p-1 text-warning/70 transition-colors hover:text-warning hover:bg-warning/10"
        aria-label="Dismiss budget warning"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

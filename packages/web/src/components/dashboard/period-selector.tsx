"use client";

import { cn } from "@/lib/utils";
import { PERIOD_OPTIONS } from "@/lib/date-helpers";
import type { Period } from "@/lib/date-helpers";

// Re-export for backward compatibility with existing imports
// Re-export retained for periodToDateRange/periodLabel (used by sessions page).
// PERIOD_OPTIONS dropped 2026-07-08 (G1 cleanup): unused via this bucket;
// consumers get it directly from @/lib/date-helpers.
export { periodToDateRange, periodLabel } from "@/lib/date-helpers";
export type { Period } from "@/lib/date-helpers";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PeriodSelectorProps {
  value: Period;
  onChange: (p: Period) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
      {PERIOD_OPTIONS.map((opt) => (
        <button type="button"
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-secondary text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

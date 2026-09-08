"use client";

import { PERIOD_OPTIONS, type Period } from "@/lib/date-helpers";
import { cn } from "@/lib/utils";

export { periodToDateRange, periodLabel } from "@/lib/date-helpers";
export type { Period } from "@/lib/date-helpers";

interface PeriodSelectorProps {
  value: Period;
  onChange: (p: Period) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-basalt-muted p-1">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          type="button"
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-basalt-bright text-basalt-foreground shadow-sm"
              : "text-basalt-muted-foreground hover:text-basalt-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

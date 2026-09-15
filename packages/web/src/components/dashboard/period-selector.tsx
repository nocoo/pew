"use client";

import { PERIOD_OPTIONS, type Period } from "@/lib/date-helpers";
import { cn } from "@/lib/utils";

export { periodToDateRange, periodLabel } from "@/lib/date-helpers";
export type { Period } from "@/lib/date-helpers";

interface PeriodSelectorProps {
  value: Period;
  onChange: (p: Period) => void;
  options?: typeof PERIOD_OPTIONS;
}

export function PeriodSelector({ value, onChange, options = PERIOD_OPTIONS }: PeriodSelectorProps) {
  return (
    <div className={cn("items-center gap-1 rounded-lg bg-basalt-muted p-1", options.length > 3 ? "grid grid-cols-2 sm:flex" : "flex")}>
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
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

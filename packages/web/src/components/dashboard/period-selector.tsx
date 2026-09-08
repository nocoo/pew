"use client";

import { ToggleGroup, ToggleGroupItem } from "@nocoo/basalt/components/toggle-group";
import { PERIOD_OPTIONS, type Period } from "@/lib/date-helpers";

export { periodToDateRange, periodLabel } from "@/lib/date-helpers";
export type { Period } from "@/lib/date-helpers";

interface PeriodSelectorProps {
  value: Period;
  onChange: (p: Period) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as Period);
      }}
      aria-label="Period"
    >
      {PERIOD_OPTIONS.map((opt) => (
        <ToggleGroupItem key={opt.value} value={opt.value}>
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

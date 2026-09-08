"use client";

import { SegmentControl } from "@nocoo/basalt/components/segment-control";
import { PERIOD_OPTIONS, type Period } from "@/lib/date-helpers";

export { periodToDateRange, periodLabel } from "@/lib/date-helpers";
export type { Period } from "@/lib/date-helpers";

interface PeriodSelectorProps {
  value: Period;
  onChange: (p: Period) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <SegmentControl
      legend="Period"
      value={value}
      onValueChange={(next) => onChange(next as Period)}
      options={PERIOD_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
    />
  );
}

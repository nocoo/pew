"use client";

import { ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Shared filter dropdown — visually consistent with PeriodSelector
// ---------------------------------------------------------------------------

interface FilterOption {
  value: string;
  label: string;
}

interface FilterDropdownProps {
  /** Visible label shown before the current value (optional) */
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  /** Text shown for the "all / unfiltered" option. Defaults to "All". */
  allLabel?: string;
}

export function FilterDropdown({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: FilterDropdownProps) {
  return (
    <div className="relative flex items-center rounded-lg bg-secondary p-1">
      {label && (
        <span className="pl-2 pr-1 text-xs text-muted-foreground select-none">
          {label}:
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md bg-transparent pl-2 pr-6 py-1.5 text-xs font-medium text-foreground outline-none cursor-pointer"
      >
        <option value="">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground"
        strokeWidth={2}
      />
    </div>
  );
}

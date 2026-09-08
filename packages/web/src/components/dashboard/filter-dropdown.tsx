"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nocoo/basalt/components/select";

interface FilterOption {
  value: string;
  label: string;
}

interface FilterDropdownProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  allLabel?: string;
}

const ALL_VALUE = "__all__";

export function FilterDropdown({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: FilterDropdownProps) {
  return (
    <div className="flex min-w-36 items-center gap-2">
      {label ? (
        <span className="shrink-0 text-xs text-basalt-muted-foreground">{label}</span>
      ) : null}
      <Select
        value={value === "" ? ALL_VALUE : value}
        onValueChange={(next) => onChange(next === ALL_VALUE ? "" : next)}
      >
        <SelectTrigger size="sm" aria-label={label ?? allLabel}>
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-y-auto">
          <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

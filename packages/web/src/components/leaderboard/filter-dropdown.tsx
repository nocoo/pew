"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FilterDropdown — generic dropdown used by agent/model selectors
// ---------------------------------------------------------------------------

export interface FilterDropdownItem {
  key: string;
  label: string;
  color: string;
}

interface FilterDropdownProps {
  /** Currently selected item key */
  value: string;
  /** Available items */
  items: readonly FilterDropdownItem[];
  /** Fired when the user picks a different item */
  onChange: (key: string) => void;
  /** Optional minimum width for the dropdown panel (default "200px") */
  panelMinWidth?: string;
}

export function FilterDropdown({
  value,
  items,
  onChange,
  panelMinWidth = "200px",
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = items.find((i) => i.key === value);

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg bg-secondary px-3 py-[10px] text-sm font-medium transition-colors",
          "text-foreground hover:bg-accent",
        )}
      >
        {selected && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: selected.color }}
          />
        )}
        {selected?.label ?? value}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-0.5 max-h-[320px] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg space-y-1"
          style={{ minWidth: panelMinWidth }}
        >
          {items.map((item) => (
            <button type="button"
              key={item.key}
              onClick={() => {
                onChange(item.key);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                value === item.key
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

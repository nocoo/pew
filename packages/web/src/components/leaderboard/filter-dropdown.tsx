"use client";

import { Button } from "@nocoo/basalt/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nocoo/basalt/components/dropdown-menu";
import { ChevronDown } from "lucide-react";

export interface FilterDropdownItem {
  key: string;
  label: string;
  color: string;
}

interface FilterDropdownProps {
  value: string;
  items: readonly FilterDropdownItem[];
  onChange: (key: string) => void;
  panelMinWidth?: string;
}

export function FilterDropdown({
  value,
  items,
  onChange,
  panelMinWidth = "200px",
}: FilterDropdownProps) {
  const selected = items.find((i) => i.key === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="shrink-0 gap-2">
          {selected ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          ) : null}
          {selected?.label ?? value}
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" style={{ minWidth: panelMinWidth }}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            className="gap-2"
            onSelect={() => onChange(item.key)}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

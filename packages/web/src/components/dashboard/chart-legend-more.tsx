"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@nocoo/basalt/components/popover";

/** The legend can collapse independently of the chart's complete series. */
export function ChartLegendMore({ items, visibleCount = 5 }: {
  items: { key: string; label: string; color: string; value?: string }[];
  visibleCount?: number;
}) {
  if (items.length <= visibleCount) return null;
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`Show all ${items.length} series`}
        className="rounded px-1 py-0.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        +{items.length - visibleCount} more
      </button>
    </PopoverTrigger>
    <PopoverContent aria-label="All chart series" align="end" collisionPadding={16}
      className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
      <ul className="space-y-2">
        {items.map((item) => <li key={item.key} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="min-w-0 flex-1 break-words">{item.label}</span>
          {item.value && <span className="shrink-0 tabular-nums">{item.value}</span>}
        </li>)}
      </ul>
    </PopoverContent>
  </Popover>;
}

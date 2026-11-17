"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@nocoo/basalt/components/popover";
import { Button } from "@nocoo/basalt/components/button";

/** The legend can collapse independently of the chart's complete series. */
export function ChartLegendMore({ items, visibleCount = 5, hiddenKeys, onSelect }: {
  items: { key: string; label: string; color: string; value?: string }[];
  visibleCount?: number;
  hiddenKeys?: ReadonlySet<string>;
  onSelect?: (key: string, metaKey: boolean) => void;
}) {
  if (items.length <= visibleCount) return null;
  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" aria-label={`Show all ${items.length} series`}
        className="h-auto rounded px-1 py-0.5 text-xs font-normal text-basalt-muted-foreground underline underline-offset-4">
        +{items.length - visibleCount} more
      </Button>
    </PopoverTrigger>
    <PopoverContent aria-label="All chart series" align="end" collisionPadding={16}
      className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
      <ul className="space-y-2">
        {items.map((item) => <li key={item.key} className="flex items-center gap-2 text-xs">
          {onSelect ? <Button type="button" variant="ghost" className="h-auto w-full justify-start gap-2 p-0 text-xs font-normal"
            aria-pressed={!hiddenKeys?.has(item.key)} onClick={(event) => onSelect(item.key, event.metaKey || event.ctrlKey)}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 break-words text-left">{item.label}</span>
          </Button> : <>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="min-w-0 flex-1 break-words">{item.label}</span>
          {item.value && <span className="shrink-0 tabular-nums">{item.value}</span>}
          </>}
        </li>)}
      </ul>
    </PopoverContent>
  </Popover>;
}

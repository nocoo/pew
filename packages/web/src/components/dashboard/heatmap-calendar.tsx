"use client";

import { useMemo, useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getYearWeeks, getColorIndex, formatDateISO, computePercentileBoundaries } from "@/lib/calendar-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeatmapDataPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface HeatmapCalendarProps {
  data: HeatmapDataPoint[];
  year: number;
  colorScale?: readonly string[];
  /** External boundaries — when provided, skip internal percentile computation */
  boundaries?: number[];
  valueFormatter?: (value: number, date: string) => string;
  metricLabel?: string;
  /** Custom legend labels [start, end] — replaces default "Less"/"More" */
  legendLabels?: [string, string];
  cellSize?: number;
  cellGap?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Color scale (GitHub-style green, using CSS variables)
// ---------------------------------------------------------------------------

export const heatmapColorScales = {
  green: [
    "hsl(var(--muted))",
    "hsl(var(--heatmap-green-1))",
    "hsl(var(--heatmap-green-2))",
    "hsl(var(--heatmap-green-3))",
    "hsl(var(--heatmap-green-4))",
  ],
} as const;

const defaultColorScale = heatmapColorScales.green;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HeatmapCalendar({
  data,
  year,
  colorScale = defaultColorScale,
  boundaries: externalBoundaries,
  valueFormatter = (v) => v.toLocaleString(),
  metricLabel = "Tokens",
  legendLabels,
  cellSize = 12,
  cellGap = 2,
  className,
}: HeatmapCalendarProps) {
  const { weeks, dataMap, boundaries, monthLabels } = useMemo(() => {
    const weeks = getYearWeeks(year);
    const dataMap = new Map<string, number>();
    const nonZeroValues: number[] = [];

    for (const d of data) {
      dataMap.set(d.date, d.value);
      if (d.value > 0) nonZeroValues.push(d.value);
    }

    // Use external boundaries if provided, otherwise compute percentile-based
    let boundaries: number[];
    if (externalBoundaries) {
      boundaries = externalBoundaries;
    } else {
      nonZeroValues.sort((a, b) => a - b);
      const levels = colorScale.length - 1;
      boundaries = computePercentileBoundaries(nonZeroValues, levels);
    }

    // Month label positions
    const monthLabels: { month: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
      const firstDayOfWeek = (weeks[weekIndex] as (typeof weeks)[number]).find(
        (d) => d.getFullYear() === year
      );
      if (firstDayOfWeek) {
        const month = firstDayOfWeek.getMonth();
        if (month !== lastMonth) {
          monthLabels.push({ month: MONTHS[month] as string, weekIndex });
          lastMonth = month;
        }
      }
    }

    return { weeks, dataMap, boundaries, monthLabels };
  }, [data, year, colorScale, externalBoundaries]);

  const labelWidth = 30;

  // Single tooltip state — avoids Radix multi-Tooltip stale-content bug
  const [hoveredCell, setHoveredCell] = useState<{
    dateStr: string;
    value: number;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCellEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, dateStr: string, value: number) => {
      const cellRect = e.currentTarget.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setHoveredCell({
        dateStr,
        value,
        rect: {
          top: cellRect.top - containerRect.top,
          left: cellRect.left - containerRect.left,
          width: cellRect.width,
          height: cellRect.height,
        },
      });
    },
    [],
  );

  const handleCellLeave = useCallback(() => {
    setHoveredCell(null);
  }, []);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      {/* Scroll container — only handles horizontal overflow.
          Tooltip lives outside so it is never clipped (overflow-x:auto
          forces overflow-y:auto, which would hide the upward tooltip). */}
      <div className="overflow-x-auto">
        <div className="inline-block">
          {/* Month labels */}
          <div
            className="relative h-4 text-xs text-muted-foreground mb-1"
            style={{ marginLeft: labelWidth }}
          >
            {monthLabels.map((label, i) => (
              <div
                key={i}
                className="absolute"
                style={{ left: label.weekIndex * (cellSize + cellGap) }}
              >
                {label.month}
              </div>
            ))}
          </div>

          <div className="flex">
            {/* Weekday labels */}
            <div
              className="flex flex-col text-xs text-muted-foreground mr-1"
              style={{ width: labelWidth }}
            >
              {WEEKDAYS.map((day, i) => (
                <div
                  key={day}
                  style={{
                    height: cellSize + cellGap,
                    lineHeight: `${cellSize + cellGap}px`,
                    visibility: i % 2 === 1 ? "visible" : "hidden",
                  }}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Heatmap grid */}
            <div className="flex" style={{ gap: cellGap }}>
              {weeks.map((week, weekIndex) => (
                <div
                  key={weekIndex}
                  className="flex flex-col"
                  style={{ gap: cellGap }}
                >
                  {week.map((date, dayIndex) => {
                    const dateStr = formatDateISO(date);
                    const value = dataMap.get(dateStr) ?? 0;
                    const isCurrentYear = date.getFullYear() === year;
                    const colorIndex = getColorIndex(
                      value,
                      boundaries,
                      colorScale
                    );

                    if (!isCurrentYear) {
                      return (
                        <div
                          key={dayIndex}
                          style={{
                            width: cellSize,
                            height: cellSize,
                            visibility: "hidden",
                          }}
                        />
                      );
                    }

                    return (
                      <div
                        key={dayIndex}
                        aria-label={`${dateStr}: ${metricLabel} ${valueFormatter(value, dateStr)}`}
                        className={cn(
                          "rounded-sm cursor-pointer transition-colors hover:ring-1 hover:ring-foreground",
                          colorIndex === 0 && "border border-border/60",
                        )}
                        style={{
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: colorScale[colorIndex],
                        }}
                        onMouseEnter={(e) => handleCellEnter(e, dateStr, value)}
                        onMouseLeave={handleCellLeave}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-end gap-1 mt-2 text-xs text-muted-foreground">
            <span>{legendLabels?.[0] ?? "Less"}</span>
            {colorScale.map((color, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-sm",
                  i === 0 && "border border-border/60",
                )}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: color,
                }}
              />
            ))}
            <span>{legendLabels?.[1] ?? "More"}</span>
          </div>
        </div>
      </div>

      {/* Floating tooltip — rendered outside the scroll container to avoid
          clipping by overflow-x-auto (which computes overflow-y to auto). */}
      {hoveredCell && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-50 w-fit rounded-[var(--radius-widget)] bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-border/50 animate-in fade-in-0 zoom-in-95"
          style={{
            top: hoveredCell.rect.top - 4,
            left: hoveredCell.rect.left + hoveredCell.rect.width / 2,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="text-sm">
            <div className="font-medium">{hoveredCell.dateStr}</div>
            <div className="text-muted-foreground">
              {metricLabel}: {valueFormatter(hoveredCell.value, hoveredCell.dateStr)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

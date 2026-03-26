"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  valueFormatter?: (value: number, date: string) => string;
  metricLabel?: string;
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
  valueFormatter = (v) => v.toLocaleString(),
  metricLabel = "Tokens",
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

    // Sort for percentile computation
    nonZeroValues.sort((a, b) => a - b);
    const levels = colorScale.length - 1; // index 0 = zero/empty
    const boundaries = computePercentileBoundaries(nonZeroValues, levels);

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
  }, [data, year, colorScale]);

  const labelWidth = 30;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <TooltipProvider>
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
                      <Tooltip key={dayIndex}>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "rounded-sm cursor-pointer transition-colors hover:ring-1 hover:ring-foreground",
                              colorIndex === 0 && "border border-border/60",
                            )}
                            style={{
                              width: cellSize,
                              height: cellSize,
                              backgroundColor: colorScale[colorIndex],
                            }}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-sm">
                            <div className="font-medium">{dateStr}</div>
                            <div className="text-muted-foreground">
                              {metricLabel}: {valueFormatter(value, dateStr)}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-end gap-1 mt-2 text-xs text-muted-foreground">
            <span>Less</span>
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
            <span>More</span>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}

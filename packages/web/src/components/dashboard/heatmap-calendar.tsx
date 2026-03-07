"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

// ---------------------------------------------------------------------------
// Calendar layout helpers
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function getYearWeeks(year: number): Date[][] {
  const weeks: Date[][] = [];
  const endDate = new Date(year, 11, 31);

  // Start from first Sunday on or before Jan 1
  const firstDay = new Date(year, 0, 1);
  firstDay.setDate(firstDay.getDate() - firstDay.getDay());

  const currentDate = new Date(firstDay);
  let currentWeek: Date[] = [];

  while (currentDate <= endDate || currentWeek.length > 0) {
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    if (currentDate > endDate) break;

    currentWeek.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return weeks;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getColorIndex(
  value: number,
  maxValue: number,
  colorScale: readonly string[]
): number {
  if (value === 0) return 0;
  const levels = colorScale.length - 1;
  const normalized = Math.min(value / maxValue, 1);
  return Math.ceil(normalized * levels);
}

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
  const { weeks, dataMap, maxValue, monthLabels } = useMemo(() => {
    const weeks = getYearWeeks(year);
    const dataMap = new Map<string, number>();
    let maxValue = 0;

    for (const d of data) {
      dataMap.set(d.date, d.value);
      if (d.value > maxValue) maxValue = d.value;
    }

    // Month label positions
    const monthLabels: { month: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
      const firstDayOfWeek = weeks[weekIndex]!.find(
        (d) => d.getFullYear() === year
      );
      if (firstDayOfWeek) {
        const month = firstDayOfWeek.getMonth();
        if (month !== lastMonth) {
          monthLabels.push({ month: MONTHS[month]!, weekIndex });
          lastMonth = month;
        }
      }
    }

    return { weeks, dataMap, maxValue, monthLabels };
  }, [data, year]);

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
                    const dateStr = formatDate(date);
                    const value = dataMap.get(dateStr) ?? 0;
                    const isCurrentYear = date.getFullYear() === year;
                    const colorIndex = getColorIndex(
                      value,
                      maxValue,
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
                            className="rounded-sm cursor-pointer transition-colors hover:ring-1 hover:ring-foreground"
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
                className="rounded-sm"
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

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { withAlpha } from "@/lib/palette";
import type { WorkingHoursDay } from "@/lib/session-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkingHoursHeatmapProps {
  data: WorkingHoursDay[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const CELL_SIZE = 28;
const CELL_GAP = 2;

const EMPTY_COLOR = "hsl(var(--muted))";

function getColor(value: number, maxValue: number): string {
  if (value === 0) return EMPTY_COLOR;
  if (maxValue === 0) return EMPTY_COLOR;

  // 4 intensity levels
  const ratio = value / maxValue;
  if (ratio <= 0.25) return withAlpha("chart-1", 0.3);
  if (ratio <= 0.5) return withAlpha("chart-1", 0.5);
  if (ratio <= 0.75) return withAlpha("chart-1", 0.75);
  return withAlpha("chart-1", 1);
}

// Hour labels for the X axis
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "12a";
  if (i < 12) return `${i}a`;
  if (i === 12) return "12p";
  return `${i - 12}p`;
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 7-row x 24-column CSS grid heatmap showing session counts by
 * day-of-week (rows) and hour-of-day (columns, UTC).
 */
export function WorkingHoursHeatmap({
  data,
  className,
}: WorkingHoursHeatmapProps) {
  const maxValue = useMemo(() => {
    let max = 0;
    for (const day of data) {
      for (const h of day.hours) {
        if (h > max) max = h;
      }
    }
    return max;
  }, [data]);

  const isEmpty = maxValue === 0;

  if (isEmpty) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className
        )}
      >
        No session data yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          Working Hours (UTC)
        </p>
        {/* Legend */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Less</span>
          {[0, 0.3, 0.5, 0.75, 1].map((alpha, i) => (
            <div
              key={i}
              className="rounded-sm"
              style={{
                width: 10,
                height: 10,
                backgroundColor:
                  alpha === 0 ? EMPTY_COLOR : withAlpha("chart-1", alpha),
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      <TooltipProvider delayDuration={0}>
        <div className="overflow-x-auto">
          <div className="inline-block">
            {/* Hour labels */}
            <div
              className="flex text-[10px] text-muted-foreground mb-1"
              style={{ paddingLeft: 36 }}
            >
              {HOUR_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="text-center"
                  style={{
                    width: CELL_SIZE + CELL_GAP,
                    visibility: i % 3 === 0 ? "visible" : "hidden",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            {data.map((day) => (
              <div key={day.day} className="flex items-center" style={{ gap: 0 }}>
                {/* Day label */}
                <div
                  className="text-[11px] text-muted-foreground shrink-0 text-right pr-2"
                  style={{ width: 36 }}
                >
                  {day.day}
                </div>

                {/* Hour cells */}
                <div className="flex" style={{ gap: CELL_GAP }}>
                  {day.hours.map((count, hour) => (
                    <Tooltip key={hour}>
                      <TooltipTrigger asChild>
                        <div
                          className="rounded-sm cursor-pointer transition-colors hover:ring-1 hover:ring-foreground"
                          style={{
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            backgroundColor: getColor(count, maxValue),
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-sm">
                          <div className="font-medium">
                            {day.day} {HOUR_LABELS[hour]}
                          </div>
                          <div className="text-muted-foreground">
                            {count} session{count !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}

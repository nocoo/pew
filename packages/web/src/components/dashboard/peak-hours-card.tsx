"use client";

import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import type { PeakSlot } from "@/lib/date-helpers";
import { fmtHour } from "@/lib/date-helpers";
import { withAlpha } from "@/lib/palette";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeakHoursCardProps {
  /** Per-hour-of-day token totals, length 24, indexed [0..23] in local time */
  hourly: number[];
  /** Top peak half-hour slots (already sorted desc), used for the ranked list */
  slots: PeakSlot[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Peak Hours card aligned with the rest of the Sessions page surface
 * (small muted title, no icon box).
 *
 * Visualization:
 * - 24-bar histogram of total tokens per local hour-of-day. The peak bar
 *   is drawn at full opacity; the rest fade according to relative load.
 * - Below the bars, a compact list of the top 3 peak half-hour slots
 *   (day-of-week + time range + token count).
 */
export function PeakHoursCard({ hourly, slots, className }: PeakHoursCardProps) {
  const max = hourly.reduce((m, v) => (v > m ? v : m), 0);
  const peakHourIndex = max > 0 ? hourly.findIndex((v) => v === max) : -1;
  const isEmpty = max === 0 && slots.length === 0;

  if (isEmpty) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-card bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No peak hour data yet
      </div>
    );
  }

  return (
    <div className={cn("rounded-card bg-secondary p-4 md:p-5", className)}>
      {/* Header — matches Working Hours / Daily Messages style */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">Peak Hours</p>
        {peakHourIndex >= 0 && (
          <p className="text-xs text-muted-foreground">
            Busiest at{" "}
            <span className="text-foreground font-medium">
              {fmtHour(peakHourIndex)}
            </span>
          </p>
        )}
      </div>

      {/* 24-bar histogram */}
      <TooltipProvider delayDuration={0}>
        <div className="flex items-end gap-[3px] h-[120px] md:h-[140px]">
          {hourly.map((tokens, h) => {
            const ratio = max > 0 ? tokens / max : 0;
            // Always render at least a 2px sliver so empty hours read as "0",
            // not "missing".
            const heightPct = max === 0 ? 0 : Math.max(ratio * 100, tokens > 0 ? 6 : 0);
            const isPeak = h === peakHourIndex && tokens > 0;
            const alpha = isPeak ? 1 : 0.25 + ratio * 0.55;
            return (
              <Tooltip key={h}>
                <TooltipTrigger asChild>
                  <div className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer group">
                    <div
                      className="w-full rounded-sm transition-all group-hover:ring-1 group-hover:ring-foreground/40"
                      style={{
                        height: `${heightPct}%`,
                        minHeight: tokens > 0 ? 2 : 0,
                        backgroundColor: withAlpha("chart-1", alpha),
                      }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-sm">
                    <div className="font-medium">{fmtHour(h)}</div>
                    <div className="text-muted-foreground tabular-nums">
                      {formatTokens(tokens)} tokens
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Hour axis ticks (every 6 hours) */}
      <div className="mt-1 flex text-[10px] text-muted-foreground tabular-nums">
        {Array.from({ length: 24 }).map((_, h) => (
          <div
            key={h}
            className="flex-1 text-center"
            style={{ visibility: h % 6 === 0 ? "visible" : "hidden" }}
          >
            {fmtHour(h)}
          </div>
        ))}
      </div>

      {/* Ranked half-hour slots */}
      {slots.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-border/40 pt-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Top slots
          </p>
          {slots.map((slot, i) => (
            <div
              key={`${slot.dayOfWeek}-${slot.timeSlot}`}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-4 text-right text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="truncate font-medium text-foreground">
                  {slot.dayOfWeek}
                </span>
                <span className="truncate text-muted-foreground">
                  {slot.timeSlot}
                </span>
              </div>
              <span className="shrink-0 font-medium text-foreground tabular-nums">
                {formatTokens(slot.totalTokens)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import type { PeakSlot } from "@/lib/date-helpers";
import { chart, chartMuted } from "@/lib/palette";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeakHoursCardProps {
  slots: PeakSlot[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact card showing the top N most active half-hour time slots.
 * Each slot displays day-of-week, time range, token count, and a mini
 * horizontal bar representing relative activity vs the top slot.
 */
export function PeakHoursCard({ slots, className }: PeakHoursCardProps) {
  if (slots.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-card)] bg-secondary p-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No peak hour data yet
      </div>
    );
  }

  const maxTokens = slots[0]!.totalTokens;

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="rounded-md bg-card p-2 text-muted-foreground">
          <Flame className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <p className="text-xs md:text-sm text-muted-foreground">Peak Hours</p>
      </div>

      {/* Ranked list */}
      <div className="space-y-3">
        {slots.map((slot, i) => {
          const pct = maxTokens > 0 ? (slot.totalTokens / maxTokens) * 100 : 0;

          return (
            <div key={`${slot.dayOfWeek}-${slot.timeSlot}`} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground w-4 text-right">
                    {i + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {slot.dayOfWeek}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {slot.timeSlot}
                  </span>
                </div>
                <span className="shrink-0 text-xs font-medium text-foreground">
                  {formatTokens(slot.totalTokens)}
                </span>
              </div>
              {/* Mini bar */}
              <div className="ml-6 h-1.5 rounded-full" style={{ background: chartMuted }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: i === 0 ? chart.teal : chart.sky,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

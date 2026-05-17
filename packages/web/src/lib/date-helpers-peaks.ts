/**
 * Peak-hour detection helpers, extracted from date-helpers.ts to stay
 * under the 400-LOC per-file complexity guideline. Pure, no I/O.
 */
import type { UsageRow } from "@/hooks/use-usage-data";

const DAY_NAMES_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type PeakSlot = {
  /** Original ISO 8601 half-hour boundary (from the highest-contributing row) */
  hourStart: string;
  /** Day of week in local time, e.g. "Monday" */
  dayOfWeek: string;
  /** Time range label, e.g. "9:00 PM – 9:30 PM" */
  timeSlot: string;
  /** Sum of total_tokens for this (dayOfWeek, timeSlot) group */
  totalTokens: number;
};

/**
 * Detect the top N most active half-hour slots across the selected period.
 *
 * @param rows     — raw UsageRow[] (should be half-hour granularity)
 * @param topN     — how many peak slots to return (default 3)
 * @param tzOffset — minutes offset from UTC (positive = west, e.g. 480 for PST)
 */
export function detectPeakHours(
  rows: UsageRow[],
  topN: number = 3,
  tzOffset: number = 0,
): PeakSlot[] {
  if (rows.length === 0) return [];

  // Group by (localDayOfWeek, localHalfHourSlot)
  const groups = new Map<string, { totalTokens: number; hourStart: string }>();

  for (const r of rows) {
    const utcMs = new Date(r.hour_start).getTime();
    const localMs = utcMs - tzOffset * 60_000;
    const local = new Date(localMs);

    // Extract local day + hour + minute using getUTC* on the shifted date
    const dayIndex = local.getUTCDay();
    const dayName = DAY_NAMES_FULL[dayIndex] as string;
    const hour = local.getUTCHours();
    const minute = local.getUTCMinutes();
    const isHalf = minute >= 30;

    const slotLabel = formatTimeSlot(hour, isHalf);
    const key = `${dayName}|${slotLabel}`;

    const existing = groups.get(key);
    if (existing) {
      existing.totalTokens += r.total_tokens;
    } else {
      groups.set(key, { totalTokens: r.total_tokens, hourStart: r.hour_start });
    }
  }

  return Array.from(groups.entries())
    .map(([key, val]) => {
      const [dayOfWeek, timeSlot] = key.split("|") as [string, string];
      return {
        hourStart: val.hourStart,
        dayOfWeek,
        timeSlot,
        totalTokens: val.totalTokens,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, topN);
}

/**
 * Format a half-hour time slot label.
 * E.g. (10, false) → "10:00 AM – 10:30 AM", (10, true) → "10:30 AM – 11:00 AM"
 */
function formatTimeSlot(hour: number, isHalf: boolean): string {
  const startHour = hour;
  const startMinute = isHalf ? 30 : 0;

  let endHour: number;
  let endMinute: number;
  if (isHalf) {
    endHour = (hour + 1) % 24;
    endMinute = 0;
  } else {
    endHour = hour;
    endMinute = 30;
  }

  return `${format12h(startHour, startMinute)} – ${format12h(endHour, endMinute)}`;
}

/** Format hour:minute as 12-hour time, e.g. (14, 30) → "2:30 PM" */
function format12h(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const m = minute === 0 ? "00" : String(minute).padStart(2, "0");
  return `${h12}:${m} ${period}`;
}

/**
 * Date / period helpers extracted from period-selector.tsx.
 *
 * Pure functions for computing date ranges from period selectors
 * and formatting labels.
 */

import type { UsageRow } from "@/hooks/use-usage-data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Period = "all" | "month" | "week";

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "week", label: "This Week" },
];

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Get today's date string in the user's local timezone.
 *
 * Uses the same UTC-shift technique as `toLocalDailyBuckets()` so that
 * "today" aligns with the bucket dates used by `computeStreak()`.
 *
 * @param tzOffset — `new Date().getTimezoneOffset()`: minutes from UTC
 *   (positive = west of UTC, e.g. 480 for PST; negative = east, e.g. -540 for JST)
 */
export function getLocalToday(tzOffset: number = 0): string {
  const localMs = Date.now() - tzOffset * 60_000;
  return new Date(localMs).toISOString().slice(0, 10);
}

/** Format a local Date as "YYYY-MM-DD" without UTC conversion. */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute from/to date strings for a given period.
 *
 * When `tzOffset` is provided the `from` boundary is padded by one day
 * towards UTC so that the server-side query (which compares against UTC
 * `hour_start`) never misses records that fall within the local period.
 * East-of-UTC timezones (negative tzOffset) would otherwise lose up to
 * 14 hours of data at the period start because local midnight maps to
 * the previous UTC day.  Padding by one day is safe because the
 * front-end aggregation helpers already convert each record to a local
 * date before bucketing.
 */
export function periodToDateRange(
  period: Period,
  tzOffset: number = 0,
): { from: string; to?: string } {
  const now = new Date();

  switch (period) {
    case "all":
      return { from: "2020-01-01" };
    case "month": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      if (tzOffset < 0) firstOfMonth.setDate(firstOfMonth.getDate() - 1);
      return { from: toLocalDateString(firstOfMonth) };
    }
    case "week": {
      const day = now.getDay();
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - day);
      if (tzOffset < 0) sunday.setDate(sunday.getDate() - 1);
      return { from: toLocalDateString(sunday) };
    }
  }
}

/** Human-readable label for a period. */
export function periodLabel(period: Period): string {
  switch (period) {
    case "all":
      return "All time";
    case "month":
      return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    case "week":
      return "This week";
  }
}

/**
 * Format a date string as a human-readable date.
 * E.g. "2026-03-10" → "Tue, Mar 10".
 */
export function formatDate(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a member-since date string.
 * E.g. "2025-01-15T..." → "January 2025".
 */
export function formatMemberSince(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Get the from/to date strings for a calendar month. */
export function getMonthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(year, month, 1);
  // Last day of the month
  const to = new Date(year, month + 1, 0);
  return {
    from: toLocalDateString(from),
    to: toLocalDateString(to),
  };
}

/** Format a year+month into a label like "March 2026". */
export function formatMonth(year: number, month: number): string {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// detectPeakHours
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

/**
 * Format a duration in seconds as a compact human-readable string.
 *
 * Examples:
 * - 0       → "—"
 * - 30      → "< 1m"
 * - 150     → "2m"
 * - 3700    → "1h 1m"
 * - 86400   → "24h"
 * - 90061   → "25h 1m"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return "< 1m";
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// ---------------------------------------------------------------------------
// fillDateRange — fill gaps + extend to today
// ---------------------------------------------------------------------------

/** Advance a "YYYY-MM-DD" string by one calendar day. */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Fill date gaps and extend a sorted array of date-keyed objects up to
 * `today` (inclusive).
 *
 * - Iterates from the first date in `data` to `max(lastDate, today)`.
 * - For each missing date, inserts a zero-value placeholder produced by
 *   `makeZero(dateString)`.
 * - Original objects are kept by reference (no cloning).
 * - Returns `[]` when `data` is empty and no `today` is provided.
 *
 * @param data     — sorted ascending by `dateKey`
 * @param dateKey  — the property name holding "YYYY-MM-DD"
 * @param makeZero — factory that creates a zero-value placeholder for a given date
 * @param today    — "YYYY-MM-DD" to extend to (default: not extended)
 */
export function fillDateRange<T>(
  data: T[],
  dateKey: keyof T & string,
  makeZero: (date: string) => T,
  today?: string,
): T[] {
  if (data.length === 0 && !today) return [];
  if (data.length === 0) return [];

  const byDate = new Map<string, T>();
  for (const item of data) {
    byDate.set(item[dateKey] as string, item);
  }

  const firstDate = (data[0] as T)[dateKey] as string;
  const lastDataDate = (data[data.length - 1] as T)[dateKey] as string;
  const endDate = today && today > lastDataDate ? today : lastDataDate;

  const result: T[] = [];
  let cursor = firstDate;
  while (cursor <= endDate) {
    result.push(byDate.get(cursor) ?? makeZero(cursor));
    cursor = nextDay(cursor);
  }

  return result;
}

/**
 * Fill date gaps in a multi-row-per-date timeline.
 *
 * Similar to `fillDateRange` but for arrays where each date may have
 * multiple rows (e.g. one per device/entity). Groups rows by `dateKey`,
 * and for each missing date between the first date and `today`, inserts
 * placeholder rows from `makeZeroRows(date)`.
 *
 * @param data        — sorted ascending by date (rows for the same date are adjacent)
 * @param dateKey     — property holding "YYYY-MM-DD"
 * @param makeZeroRows — factory producing zero-value rows for a missing date
 * @param today       — "YYYY-MM-DD" to extend to
 */
export function fillTimelineGaps<T>(
  data: T[],
  dateKey: keyof T & string,
  makeZeroRows: (date: string) => T[],
  today?: string,
): T[] {
  if (data.length === 0) return [];

  // Group existing rows by date, preserving order within each date
  const dateGroups = new Map<string, T[]>();
  for (const item of data) {
    const d = item[dateKey] as string;
    let group = dateGroups.get(d);
    if (!group) {
      group = [];
      dateGroups.set(d, group);
    }
    group.push(item);
  }

  const firstDate = (data[0] as T)[dateKey] as string;
  const dates = Array.from(dateGroups.keys()).sort();
  const lastDataDate = dates[dates.length - 1] as string;
  const endDate = today && today > lastDataDate ? today : lastDataDate;

  const result: T[] = [];
  let cursor = firstDate;
  while (cursor <= endDate) {
    const group = dateGroups.get(cursor);
    if (group) {
      result.push(...group);
    } else {
      result.push(...makeZeroRows(cursor));
    }
    cursor = nextDay(cursor);
  }

  return result;
}

// ---------------------------------------------------------------------------
// UTC ↔ local datetime-local input conversion
// ---------------------------------------------------------------------------

/**
 * Convert a UTC ISO datetime string to a `datetime-local` input value
 * in the user's local timezone.
 *
 * "2026-03-15T00:00:00Z" → "2026-03-15T08:00" (for UTC+8)
 *
 * The `datetime-local` input expects "YYYY-MM-DDTHH:mm" without timezone.
 */
export function utcToLocalDatetimeValue(isoUtc: string): string {
  const d = new Date(isoUtc);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Convert a `datetime-local` input value (local timezone) to a UTC ISO
 * datetime string for API submission.
 *
 * "2026-03-15T08:00" (local, UTC+8) → "2026-03-15T00:00:00Z"
 *
 * `new Date(localString)` interprets the value as local time, then
 * `.toISOString()` converts to UTC. We strip the millisecond portion
 * to match our stored format ("...T00:00:00Z" not "...T00:00:00.000Z").
 */
export function localDatetimeValueToUtc(localValue: string): string {
  const d = new Date(localValue);
  return d.toISOString().replace(".000Z", "Z");
}

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

/** Compute from/to date strings for a given period. */
export function periodToDateRange(period: Period): { from: string; to?: string } {
  const now = new Date();

  switch (period) {
    case "all":
      return { from: "2020-01-01" };
    case "month": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toLocalDateString(firstOfMonth) };
    }
    case "week": {
      const day = now.getDay();
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - day);
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
    const dayName = DAY_NAMES_FULL[dayIndex]!;
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

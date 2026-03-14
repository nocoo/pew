/**
 * Shared season helpers.
 *
 * Season status is derived from dates, never stored in the database.
 * Season dates are ISO 8601 UTC datetime strings (e.g. "2026-03-15T00:00:00Z").
 */

import type { SeasonStatus } from "@pew/core";

/**
 * Derive season status from start/end ISO datetime strings compared to now.
 *
 * - now < start_date  → "upcoming"
 * - start_date <= now <= end_date  → "active"
 * - now > end_date  → "ended"
 *
 * Uses epoch ms comparison to avoid ISO format mismatches
 * (toISOString() includes .000Z but stored dates may omit ms).
 */
export function deriveSeasonStatus(
  startDate: string,
  endDate: string,
  now?: Date
): SeasonStatus {
  const nowMs = (now ?? new Date()).getTime();
  if (nowMs < new Date(startDate).getTime()) return "upcoming";
  if (nowMs > new Date(endDate).getTime()) return "ended";
  return "active";
}

/**
 * Format a season ISO datetime for display in the user's local timezone.
 *
 * Returns a human-friendly string like "Mar 15, 2026, 8:00 AM".
 */
export function formatSeasonDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

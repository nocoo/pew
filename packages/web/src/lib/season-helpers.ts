/**
 * Shared season time boundary helpers.
 *
 * The core insight: end_date is inclusive at minute precision, meaning
 * usage recorded at end_date:00 through end_date:59 should be counted.
 * This requires adding 60_000ms (1 minute) to get the exclusive boundary
 * for comparisons.
 *
 * These helpers centralize this logic to ensure consistency across:
 * - API queries (leaderboard data aggregation)
 * - Countdown timer display
 * - Season status badge ("Active" vs "Ended")
 */

/**
 * Convert an ISO end_date to an exclusive upper bound timestamp (ms).
 *
 * end_date is inclusive at minute precision, so we add 60_000ms (1 minute)
 * to get the exclusive boundary for `<` comparisons.
 *
 * @example
 * // If end_date is "2026-03-31T23:59:00Z"
 * // Returns timestamp for "2026-04-01T00:00:00Z"
 */
export function getSeasonEndExclusive(endDate: string): number {
  return new Date(endDate).getTime() + 60_000;
}

/**
 * Convert an ISO end_date to an exclusive upper bound ISO string.
 *
 * Same logic as getSeasonEndExclusive() but returns an ISO string
 * for use in SQL queries.
 */
export function getSeasonEndExclusiveISO(endDate: string): string {
  return new Date(getSeasonEndExclusive(endDate)).toISOString();
}

/**
 * Check if a season has ended (now is past the exclusive end boundary).
 *
 * @param endDate - Season end date (ISO string, inclusive at minute precision)
 * @param now - Optional current timestamp for testing
 */
export function isSeasonEnded(endDate: string, now?: Date): boolean {
  const nowMs = (now ?? new Date()).getTime();
  return nowMs >= getSeasonEndExclusive(endDate);
}

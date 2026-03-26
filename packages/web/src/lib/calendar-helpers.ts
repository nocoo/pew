/**
 * Calendar/heatmap layout helpers extracted from heatmap-calendar.tsx.
 *
 * These are the most algorithmically complex functions in the web package:
 * - getYearWeeks: builds the full Sunday-anchored week grid for a year.
 * - getColorIndex: maps a value to a color bucket index.
 * - formatDateISO: converts a Date to "YYYY-MM-DD".
 */

// ---------------------------------------------------------------------------
// Calendar layout
// ---------------------------------------------------------------------------

/**
 * Build an array of week arrays (Date[][]) covering an entire year,
 * anchored on Sundays. Starts from the first Sunday on or before Jan 1.
 */
export function getYearWeeks(year: number): Date[][] {
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

// ---------------------------------------------------------------------------
// Color index (percentile-based)
// ---------------------------------------------------------------------------

/**
 * Compute percentile boundaries for color bucketing.
 *
 * Given a sorted array of **non-zero** values, splits them into `levels`
 * equal-frequency buckets and returns the upper-bound value of each bucket.
 *
 * Example with 4 levels and [1,2,3,4,5,6,7,8]:
 *   boundaries = [2, 4, 6, 8]  — each bucket holds ~25% of values.
 *
 * Returns an empty array when `sortedValues` is empty.
 */
export function computePercentileBoundaries(
  sortedValues: number[],
  levels: number,
): number[] {
  if (sortedValues.length === 0 || levels <= 0) return [];

  const boundaries: number[] = [];
  for (let i = 1; i <= levels; i++) {
    // Index at the i/levels percentile (clamp to last element)
    const idx = Math.min(
      Math.ceil((i / levels) * sortedValues.length) - 1,
      sortedValues.length - 1,
    );
    boundaries.push(sortedValues[idx] as number);
  }
  return boundaries;
}

/**
 * Map a numeric value to an index in a color scale array using
 * percentile boundaries.
 *
 * Index 0 is reserved for zero values (empty/no-data).
 * Non-zero values are placed into buckets [1..colorScale.length-1]
 * based on which percentile boundary they fall into.
 *
 * When boundaries are empty (no non-zero data), any non-zero value
 * maps to the lowest color index (1).
 */
export function getColorIndex(
  value: number,
  boundaries: number[],
  colorScale: readonly string[],
): number {
  if (value === 0) return 0;
  if (boundaries.length === 0) return 1;

  // Find the first boundary that this value fits into
  for (let i = 0; i < boundaries.length; i++) {
    if (value <= (boundaries[i] as number)) return i + 1;
  }
  // Value exceeds all boundaries — top bucket
  return colorScale.length - 1;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** Format a Date object as an ISO date string "YYYY-MM-DD". */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Display formatters — pure presentation helpers shared across the dashboard.
//
// This file is the canonical home for *display* formatters (numbers, costs,
// durations). The pre-existing locations re-export from here so external
// call sites keep working without churn:
//
//   - `lib/utils.ts`        — formatTokens, formatTokensFull
//   - `lib/pricing.ts`      — formatCost
//   - `lib/date-helpers.ts` — formatDuration
//
// New code should import from `@/lib/format` directly.
// ---------------------------------------------------------------------------

/** Format large token counts to a compact human-readable string (e.g. 1.2M, 45.3K). */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${(count / 1_000_000_000).toFixed(1)}B`;
}

/** Format token count with full digits and comma separators (e.g. 11,832,456,789). */
export function formatTokensFull(count: number): string {
  return count.toLocaleString("en-US");
}

/** Format USD cost with appropriate precision and thousand separators. */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  if (cost < 100) return `$${cost.toFixed(2)}`;
  return `$${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export interface FormatDurationOptions {
  /** Show seconds explicitly and render zero as "0s" instead of "—". */
  precise?: boolean;
}

/**
 * Format a duration in seconds as a compact human-readable string.
 *
 * Examples (default):
 * - 0       → "—"
 * - 30      → "< 1m"
 * - 150     → "2m"
 * - 3700    → "1h 1m"
 *
 * Examples (precise: true):
 * - 0       → "0s"
 * - 30      → "30s"
 * - 90      → "1m 30s"
 */
export function formatDuration(seconds: number, opts?: FormatDurationOptions): string {
  const precise = opts?.precise ?? false;

  if (seconds <= 0) return precise ? "0s" : "—";
  if (seconds < 60) return precise ? `${seconds}s` : "< 1m";

  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const remainderSec = seconds % 60;

  if (hours === 0) {
    if (precise && remainderSec > 0) return `${minutes}m ${remainderSec}s`;
    return `${minutes}m`;
  }
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

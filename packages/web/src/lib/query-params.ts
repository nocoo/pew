/**
 * Query parameter parsing helpers for API route handlers.
 *
 * Pure parsers — they never construct responses. Callers retain full control
 * over error message wording and HTTP status, so per-route 400 payloads stay
 * exactly as they were.
 */

export interface ParseBoundedIntOptions {
  min: number;
  max?: number;
  defaultValue?: number;
}

/**
 * Parse a query string as a bounded integer.
 *
 * - `raw == null`  → `defaultValue` when provided, otherwise `"invalid"`.
 * - `raw` present but `parseInt(..., 10)` yields NaN, or value lies outside
 *   `[min, max]` → `"invalid"`.
 * - Otherwise → the parsed integer.
 *
 * Behavior is intentionally byte-equivalent to the existing inline pattern:
 * `parseInt("1abc", 10)` is accepted and returns `1`, matching prior code.
 */
export function parseBoundedInt(
  raw: string | null,
  opts: ParseBoundedIntOptions,
): number | "invalid" {
  if (raw == null) {
    return opts.defaultValue !== undefined ? opts.defaultValue : "invalid";
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return "invalid";
  if (parsed < opts.min) return "invalid";
  if (opts.max !== undefined && parsed > opts.max) return "invalid";
  return parsed;
}

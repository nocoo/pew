/**
 * Coerce an epoch value to milliseconds.
 * Values < 1e12 are treated as seconds and multiplied by 1000.
 */
export function coerceEpochMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 1e12) return Math.floor(n * 1000);
  return Math.floor(n);
}

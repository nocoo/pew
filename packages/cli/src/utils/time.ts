/**
 * Largest epoch-millisecond value the ECMAScript Date type can represent
 * (±100,000,000 days from the epoch). Anything larger is finite but produces
 * an Invalid Date whose `toISOString()` throws a RangeError.
 */
export const MAX_EPOCH_MS = 8_640_000_000_000_000;

/**
 * True when `ms` is a finite epoch-millisecond value inside the range that
 * `new Date(ms).toISOString()` accepts. Use before converting an untrusted
 * numeric timestamp, so one bad row cannot abort a whole-file parse.
 */
export function isRepresentableEpochMs(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_EPOCH_MS;
}

/**
 * Coerce an epoch value to milliseconds.
 * Values < 1e12 are treated as seconds and multiplied by 1000.
 * Values outside the representable Date range and non-finite values yield 0.
 */
export function coerceEpochMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
  return isRepresentableEpochMs(ms) ? ms : 0;
}

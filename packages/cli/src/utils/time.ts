/**
 * Largest epoch ms the ingest contract can represent: 9999-12-31T23:59:59.999Z.
 * `new Date(1e20).toISOString()` throws RangeError outright, and anything past
 * this bound serializes to a year the server's ISO validator rejects.
 *
 * ECMAScript Date itself tolerates far more (±8.64e15, which formats as
 * `+275760-…` rather than throwing), but that instant is rejected downstream,
 * so the server contract is the tighter and correct bound for a parser. Every
 * caller would otherwise have to re-check the resulting string against the
 * 4-digit-year rule.
 */
export const MAX_EPOCH_MS = 253_402_300_799_999;

/**
 * True when `ms` is a finite epoch-millisecond value inside the range the
 * ingest contract accepts. Use before converting an untrusted numeric
 * timestamp, so one bad row cannot abort a whole-file parse.
 */
export function isRepresentableEpochMs(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_EPOCH_MS;
}

/**
 * Coerce an epoch value to milliseconds.
 * Values < 1e12 are treated as seconds and multiplied by 1000.
 *
 * Returns 0 for anything that cannot be a real instant under the ingest
 * contract: `new Date(1e20).toISOString()` throws RangeError, and an epoch
 * past the 9999 bound would otherwise be rejected by the server.
 */
export function coerceEpochMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = n < 1e12 ? n * 1000 : n;
  if (!Number.isFinite(ms) || ms > MAX_EPOCH_MS) return 0;
  return Math.floor(ms);
}

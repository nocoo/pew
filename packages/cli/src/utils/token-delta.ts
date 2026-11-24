import type { TokenDelta } from "@pew/core";

/** Coerce to non-negative integer, returning 0 for invalid values */
export function toNonNegInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Check if a TokenDelta is all zeros */
export function isAllZero(delta: TokenDelta): boolean {
  return (
    delta.inputTokens === 0 &&
    delta.cachedInputTokens === 0 &&
    delta.outputTokens === 0 &&
    delta.reasoningOutputTokens === 0
  );
}

/** Compute total from a TokenDelta (for reset detection) */
function totalOf(d: TokenDelta): number {
  return d.inputTokens + d.cachedInputTokens + d.outputTokens + d.reasoningOutputTokens;
}

/**
 * Diff current cumulative totals against previous.
 * Returns null if no change, or the full current if totals reset (decreased).
 * Used for cumulative OpenCode totals.
 */
export function diffTotals(current: TokenDelta, previous: TokenDelta | null): TokenDelta | null {
  if (!previous) return current;

  // Same → no change
  if (
    current.inputTokens === previous.inputTokens &&
    current.cachedInputTokens === previous.cachedInputTokens &&
    current.outputTokens === previous.outputTokens &&
    current.reasoningOutputTokens === previous.reasoningOutputTokens
  ) {
    return null;
  }

  // Total decreased → reset, treat current as full delta
  if (totalOf(current) < totalOf(previous)) return current;

  const delta: TokenDelta = {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
    ),
  };

  return isAllZero(delta) ? null : delta;
}

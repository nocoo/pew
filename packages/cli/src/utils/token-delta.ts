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

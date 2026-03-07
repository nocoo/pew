import type { TokenDelta } from "@zebra/core";

/**
 * Floor a timestamp to the nearest half-hour UTC boundary.
 * Returns ISO string like "2026-03-07T10:00:00.000Z" or "2026-03-07T10:30:00.000Z".
 * Returns null if the timestamp is unparseable.
 */
export function toUtcHalfHourStart(ts: string | number): string | null {
  const dt = new Date(ts);
  if (!Number.isFinite(dt.getTime())) return null;

  const minutes = dt.getUTCMinutes();
  const halfMinute = minutes >= 30 ? 30 : 0;

  const bucketStart = new Date(
    Date.UTC(
      dt.getUTCFullYear(),
      dt.getUTCMonth(),
      dt.getUTCDate(),
      dt.getUTCHours(),
      halfMinute,
      0,
      0,
    ),
  );

  return bucketStart.toISOString();
}

/**
 * Create a composite bucket key from source, model, and half-hour start.
 * Format: "source|model|hourStart"
 */
export function bucketKey(
  source: string,
  model: string,
  hourStart: string,
): string {
  return `${source}|${model}|${hourStart}`;
}

/** Create a TokenDelta with all zeros */
export function emptyTokenDelta(): TokenDelta {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

/** Add delta values into target in place */
export function addTokens(target: TokenDelta, delta: TokenDelta): void {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
}

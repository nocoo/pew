import { readFile } from "node:fs/promises";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

/** Result of parsing a Gemini session JSON file */
export interface GeminiFileResult {
  deltas: ParsedDelta[];
  lastIndex: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
}

/**
 * Normalize Gemini's token object to our TokenDelta format.
 *
 * Gemini fields:
 *   input             → inputTokens
 *   cached            → cachedInputTokens
 *   output + tool     → outputTokens
 *   thoughts          → reasoningOutputTokens
 */
export function normalizeGeminiTokens(
  tokens: Record<string, unknown> | null | undefined,
): TokenDelta | null {
  if (!tokens || typeof tokens !== "object") return null;

  return {
    inputTokens: toNonNegInt(tokens.input),
    cachedInputTokens: toNonNegInt(tokens.cached),
    outputTokens: toNonNegInt(tokens.output) + toNonNegInt(tokens.tool),
    reasoningOutputTokens: toNonNegInt(tokens.thoughts),
  };
}

/** Compute total from a TokenDelta (for reset detection) */
function totalOf(d: TokenDelta): number {
  return d.inputTokens + d.cachedInputTokens + d.outputTokens + d.reasoningOutputTokens;
}

/**
 * Diff current cumulative totals against previous.
 * Returns null if no change, or the full current if totals reset (decreased).
 * Shared by Gemini and OpenCode parsers.
 */
export function diffTotals(
  current: TokenDelta,
  previous: TokenDelta | null,
): TokenDelta | null {
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
    cachedInputTokens: Math.max(
      0,
      current.cachedInputTokens - previous.cachedInputTokens,
    ),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
    ),
  };

  return isAllZero(delta) ? null : delta;
}

/**
 * Parse a Gemini CLI session JSON file.
 *
 * Gemini stores one JSON file per session with a `messages[]` array.
 * Each `type: "gemini"` message has cumulative `tokens` — we diff
 * against the previous totals to compute per-message deltas.
 */
export async function parseGeminiFile(opts: {
  filePath: string;
  startIndex: number;
  lastTotals: TokenDelta | null;
}): Promise<GeminiFileResult> {
  const { filePath } = opts;
  let { startIndex, lastTotals } = opts;
  const deltas: ParsedDelta[] = [];
  let lastModel: string | null = null;

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { deltas, lastIndex: startIndex, lastTotals, lastModel };
  }

  if (!raw.trim()) {
    return { deltas, lastIndex: startIndex, lastTotals, lastModel };
  }

  let session: Record<string, unknown>;
  try {
    session = JSON.parse(raw);
  } catch {
    return { deltas, lastIndex: startIndex, lastTotals, lastModel };
  }

  const messages = Array.isArray(session?.messages)
    ? (session.messages as Record<string, unknown>[])
    : [];

  // Reset if lastIndex is beyond the array (file rewrite)
  if (startIndex >= messages.length) {
    startIndex = -1;
    lastTotals = null;
  }

  let totals: TokenDelta | null = lastTotals;
  let model: string | null = lastModel;
  const begin = startIndex + 1;

  for (let idx = begin; idx < messages.length; idx++) {
    const msg = messages[idx];
    if (!msg || typeof msg !== "object") continue;

    // Track model
    const msgModel =
      typeof msg.model === "string" ? msg.model.trim() : null;
    if (msgModel) model = msgModel;

    // Extract timestamp
    const timestamp =
      typeof msg.timestamp === "string" ? msg.timestamp : null;

    // Normalize tokens
    const currentTotals = normalizeGeminiTokens(
      msg.tokens as Record<string, unknown> | null,
    );
    if (!timestamp || !currentTotals) {
      totals = currentTotals || totals;
      continue;
    }

    // Compute delta
    const delta = diffTotals(currentTotals, totals);
    if (!delta || isAllZero(delta)) {
      totals = currentTotals;
      continue;
    }

    deltas.push({
      source: "gemini-cli" as Source,
      model: model || "unknown",
      timestamp,
      tokens: delta,
    });

    totals = currentTotals;
  }

  return {
    deltas,
    lastIndex: messages.length - 1,
    lastTotals: totals,
    lastModel: model,
  };
}

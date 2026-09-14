import { readFile } from "node:fs/promises";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { diffTotals } from "./gemini.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import { coerceEpochMs } from "../utils/time.js";
import { decimalCost, inclusiveAccounting, optionalToken } from "../utils/accounting.js";

/** Result of parsing a single OpenCode message file */
export interface OpenCodeFileResult {
  delta: ParsedDelta | null;
  messageKey: string | null;
  lastTotals: TokenDelta | null;
  lastCacheWrite?: number | null;
}

export function openCodeAccounting(tokens: TokenDelta, msg: Record<string, unknown>, model: string,
  previous: TokenDelta | null = null, previousWrite?: number | null) {
  const raw = msg.tokens as Record<string, unknown>;
  const cache = raw.cache as Record<string, unknown> | undefined;
  const difference = (value: unknown, prior: number | null | undefined) =>
    optionalToken(value) === null || (previous && optionalToken(prior) === null) ? null : Number(value) - Number(prior ?? 0);
  const cost = !previous ? decimalCost(msg.cost, "opencode-sdk", "estimate", Number(msg.cost) > 0 ? "complete" : "unknown") : null;
  return inclusiveAccounting(tokens, { input: tokens.inputTokens + tokens.cachedInputTokens,
    uncachedInput: raw.input, visibleOutput: raw.output,
    read: difference(cache?.read, previous?.cachedInputTokens), write: difference(cache?.write, previousWrite),
    output: tokens.outputTokens + tokens.reasoningOutputTokens, reasoning: difference(raw.reasoning, previous?.reasoningOutputTokens) },
  { origin: "opencode:message", model, provider: typeof msg.providerID === "string" ? msg.providerID : null,
    aggregate: !!previous, quality: previous ? "derived" : "reported", reportedCosts: cost ? [cost] : [] });
}

/**
 * Normalize OpenCode's token object to our TokenDelta format.
 *
 * OpenCode fields:
 *   input + cache.write  → inputTokens
 *   cache.read           → cachedInputTokens
 *   output               → outputTokens
 *   reasoning            → reasoningOutputTokens
 */
export function normalizeOpenCodeTokens(
  tokens: Record<string, unknown> | null | undefined,
): TokenDelta | null {
  if (!tokens || typeof tokens !== "object") return null;

  const cache = tokens.cache as Record<string, unknown> | undefined;
  const cacheWrite = toNonNegInt(cache?.write);
  const cacheRead = toNonNegInt(cache?.read);

  return {
    inputTokens: toNonNegInt(tokens.input) + cacheWrite,
    cachedInputTokens: cacheRead,
    outputTokens: toNonNegInt(tokens.output),
    reasoningOutputTokens: toNonNegInt(tokens.reasoning),
  };
}

/**
 * Parse a single OpenCode message JSON file.
 *
 * Each file is a standalone JSON object for one message.
 * Uses diff against previous totals to compute incremental deltas
 * (reuses diffTotals from Gemini parser — same logic).
 */
export async function parseOpenCodeFile(opts: {
  filePath: string;
  lastTotals: TokenDelta | null;
  lastCacheWrite?: number | null;
  includeAccounting?: boolean;
}): Promise<OpenCodeFileResult> {
  const { filePath, lastTotals } = opts;

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { delta: null, messageKey: null, lastTotals };
  }

  if (!raw.trim()) {
    return { delta: null, messageKey: null, lastTotals };
  }

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { delta: null, messageKey: null, lastTotals };
  }

  // Only process assistant messages
  if (msg.role !== "assistant") {
    return { delta: null, messageKey: null, lastTotals };
  }

  // Derive message key
  const sessionId = typeof msg.sessionID === "string" ? msg.sessionID : null;
  const msgId = typeof msg.id === "string" ? msg.id : null;
  const messageKey =
    sessionId && msgId ? `${sessionId}|${msgId}` : null;

  // Normalize tokens
  const currentTotals = normalizeOpenCodeTokens(
    msg.tokens as Record<string, unknown> | null,
  );
  if (!currentTotals) {
    return { delta: null, messageKey, lastTotals };
  }

  // Diff against previous
  const tokenDelta = diffTotals(currentTotals, lastTotals);
  if (!tokenDelta || isAllZero(tokenDelta)) {
    return { delta: null, messageKey, lastTotals: currentTotals };
  }

  // Extract timestamp from time.completed or time.created
  const time = msg.time as Record<string, unknown> | undefined;
  const timestampMs =
    coerceEpochMs(time?.completed) || coerceEpochMs(time?.created);
  if (!timestampMs) {
    return { delta: null, messageKey, lastTotals };
  }

  // Extract model
  const model =
    typeof msg.modelID === "string"
      ? msg.modelID.trim()
      : typeof msg.model === "string"
        ? (msg.model as string).trim()
        : "unknown";

  return {
    delta: {
      source: "opencode" as Source,
      model,
      timestamp: new Date(timestampMs).toISOString(),
      tokens: tokenDelta,
      ...(opts.includeAccounting ? { accounting: openCodeAccounting(tokenDelta, msg, model, lastTotals, opts.lastCacheWrite) } : {}),
    },
    messageKey,
    lastTotals: currentTotals,
    ...(opts.includeAccounting ? { lastCacheWrite: optionalToken((msg.tokens as { cache?: { write?: unknown } }).cache?.write) } : {}),
  };
}

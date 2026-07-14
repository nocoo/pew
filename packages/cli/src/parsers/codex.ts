/**
 * Codex CLI token parser.
 *
 * Parses Codex JSONL rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * incrementally from a byte offset.
 *
 * Strategy: Cumulative total_token_usage with diff (like Gemini).
 * Each `event_msg` with `payload.type === "token_count"` contains running totals.
 * We diff consecutive totals to produce per-turn deltas.
 *
 * Model is tracked from `turn_context.payload.model` or `session_meta.payload.model`.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

/** Result of parsing a single Codex JSONL rollout file */
export interface CodexFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
  /** Last seen cumulative totals (for resuming incremental parsing) */
  lastTotals: TokenDelta | null;
  /** Last seen model identifier */
  lastModel: string | null;
}

/**
 * Diff two cumulative TokenDelta values (raw OpenAI-shaped totals).
 * If any field goes negative (counter reset), treat the new value as absolute.
 */
function diffTotals(current: TokenDelta, previous: TokenDelta): TokenDelta {
  const dInput = current.inputTokens - previous.inputTokens;
  const dCached = current.cachedInputTokens - previous.cachedInputTokens;
  const dOutput = current.outputTokens - previous.outputTokens;
  const dReasoning = current.reasoningOutputTokens - previous.reasoningOutputTokens;

  // If any field is negative, assume counter reset — use absolute values
  if (dInput < 0 || dCached < 0 || dOutput < 0 || dReasoning < 0) {
    return { ...current };
  }

  return {
    inputTokens: dInput,
    cachedInputTokens: dCached,
    outputTokens: dOutput,
    reasoningOutputTokens: dReasoning,
  };
}

/**
 * Normalize raw Codex/OpenAI totals (or a raw delta of them) to disjoint fields.
 *
 * OpenAI reports inclusive counts:
 *   total_tokens = input_tokens + output_tokens
 *   cached_input_tokens ⊆ input_tokens
 *   reasoning_output_tokens ⊆ output_tokens
 *
 * pew stores disjoint fields so SUM(total) and estimateCost never double-count.
 * Cursor lastTotals must remain raw for correct resume diffs — only emitted
 * deltas are normalized.
 */
export function normalizeCodexUsage(raw: TokenDelta): TokenDelta {
  return {
    inputTokens: Math.max(0, raw.inputTokens - raw.cachedInputTokens),
    cachedInputTokens: raw.cachedInputTokens,
    outputTokens: Math.max(0, raw.outputTokens - raw.reasoningOutputTokens),
    reasoningOutputTokens: raw.reasoningOutputTokens,
  };
}

/**
 * Parse a Codex CLI JSONL rollout file incrementally from a byte offset.
 *
 * Extracts token deltas from `event_msg` lines with `payload.type === "token_count"`.
 * Uses cumulative `total_token_usage` with diff strategy.
 * Tracks model from `turn_context` and `session_meta` events.
 */
export async function parseCodexFile(opts: {
  filePath: string;
  startOffset: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
}): Promise<CodexFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];
  let lastTotals = opts.lastTotals;
  let lastModel = opts.lastModel;

  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: startOffset, lastTotals, lastModel };

  const endOffset = st.size;
  if (endOffset === 0 || startOffset >= endOffset) {
    return { deltas, endOffset: endOffset === 0 ? 0 : endOffset, lastTotals, lastModel };
  }

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const type = typeof obj.type === "string" ? obj.type : null;
      const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : null;
      const payload = obj.payload as Record<string, unknown> | undefined;

      // Track model from session_meta
      if (type === "session_meta" && payload) {
        const model = typeof payload.model === "string" ? payload.model.trim() : null;
        if (model) lastModel = model;
        continue;
      }

      // Track model from turn_context (overrides session_meta)
      if (type === "turn_context" && payload) {
        const model = typeof payload.model === "string" ? payload.model.trim() : null;
        if (model) lastModel = model;
        continue;
      }

      // Extract token counts from event_msg with type=token_count
      if (type === "event_msg" && payload?.type === "token_count" && timestamp) {
        const info = payload.info as Record<string, unknown> | undefined;
        if (!info) continue;

        const usage = info.total_token_usage as Record<string, unknown> | undefined;
        if (!usage || typeof usage !== "object") continue;

        // Keep raw inclusive totals for cursor resume + diffing
        const currentTotals: TokenDelta = {
          inputTokens: toNonNegInt(usage.input_tokens),
          cachedInputTokens: toNonNegInt(usage.cached_input_tokens),
          outputTokens: toNonNegInt(usage.output_tokens),
          reasoningOutputTokens: toNonNegInt(usage.reasoning_output_tokens),
        };

        const rawDelta = lastTotals
          ? diffTotals(currentTotals, lastTotals)
          : { ...currentTotals };
        lastTotals = currentTotals;

        // Emit disjoint fields so cost/total never double-count cache/reasoning
        const tokens = normalizeCodexUsage(rawDelta);
        if (isAllZero(tokens)) continue;

        deltas.push({
          source: "codex" as Source,
          model: lastModel || "unknown",
          timestamp,
          tokens,
        });
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { deltas, endOffset, lastTotals, lastModel };
}

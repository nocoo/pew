/**
 * Codex CLI token parser.
 *
 * Parses Codex JSONL rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * incrementally from a byte offset.
 *
 * Strategy: count each unique cumulative-usage graph edge once.
 * `last_token_usage` is the exact request delta; pairing it with the new
 * `total_token_usage` dedupes replayed history while retaining fork branches.
 *
 * Model is tracked from `turn_context.payload.model` or `session_meta.payload.model`.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { jsonlStreamBound } from "../utils/jsonl-offset.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

/** Result of parsing a single Codex JSONL rollout file */
export interface CodexFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
  /** Last seen cumulative totals (for resuming incremental parsing) */
  lastTotals: TokenDelta | null;
  /** Last seen model identifier */
  lastModel: string | null;
  /** Highest cumulative totals for a shared Goal counter scope. */
  highWaterTotals: TokenDelta | null;
  /** Usage-edge keys first observed while parsing this file. */
  usageKeys: string[];
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
 * Diff a replayed cumulative counter against a cross-file high-water mark.
 * Goal continuations and subagents can replay the same process-wide counter
 * in many rollout files. Only component-wise growth is new usage.
 */
function diffHighWater(current: TokenDelta, previous: TokenDelta): TokenDelta {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
  };
}

function mergeHighWater(current: TokenDelta, previous: TokenDelta): TokenDelta {
  return {
    inputTokens: Math.max(current.inputTokens, previous.inputTokens),
    cachedInputTokens: Math.max(current.cachedInputTokens, previous.cachedInputTokens),
    outputTokens: Math.max(current.outputTokens, previous.outputTokens),
    reasoningOutputTokens: Math.max(current.reasoningOutputTokens, previous.reasoningOutputTokens),
  };
}

/**
 * Stable, lossless key for one edge in Codex's cumulative usage graph.
 *
 * Forked subagents inherit their parent's total_token_usage and then branch.
 * The pair (new cumulative total, last request usage) identifies the graph
 * edge, while either value alone is insufficient. Base-36 keeps cursor JSON
 * compact without introducing hash collisions.
 */
export function codexUsageEdgeKey(current: TokenDelta, last: TokenDelta): string {
  return [
    current.inputTokens,
    current.cachedInputTokens,
    current.outputTokens,
    current.reasoningOutputTokens,
    last.inputTokens,
    last.cachedInputTokens,
    last.outputTokens,
    last.reasoningOutputTokens,
  ].map((value) => value.toString(36)).join(".");
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
 * Uses exact `last_token_usage` with cumulative-edge dedup. Very old logs
 * without that field fall back to cumulative diffing.
 * Tracks model from `turn_context` and `session_meta` events.
 */
export async function parseCodexFile(opts: {
  filePath: string;
  startOffset: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
  endBound?: number;
  /** Present only when multiple rollouts share one cumulative Goal counter. */
  highWaterTotals?: TokenDelta | null;
  /** Dedup set shared by every rollout in the resolved Goal root scope. */
  seenUsageKeys?: Set<string>;
}): Promise<CodexFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];
  let lastTotals = opts.lastTotals;
  let lastModel = opts.lastModel;
  const useHighWater = Object.hasOwn(opts, "highWaterTotals");
  let highWaterTotals = opts.highWaterTotals ?? null;
  const seenUsageKeys = opts.seenUsageKeys ?? new Set<string>();
  const usageKeys: string[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) {
    return { deltas, endOffset: startOffset, lastTotals, lastModel, highWaterTotals, usageKeys };
  }

  const endOffset = jsonlStreamBound(st.size, opts.endBound);
  if (endOffset === 0 || startOffset >= endOffset) {
    return {
      deltas,
      endOffset: endOffset === 0 ? 0 : endOffset,
      lastTotals,
      lastModel,
      highWaterTotals,
      usageKeys,
    };
  }

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
    end: endOffset - 1,
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

        const lastUsage = info.last_token_usage as Record<string, unknown> | undefined;
        let rawDelta: TokenDelta;
        if (lastUsage && typeof lastUsage === "object") {
          const last: TokenDelta = {
            inputTokens: toNonNegInt(lastUsage.input_tokens),
            cachedInputTokens: toNonNegInt(lastUsage.cached_input_tokens),
            outputTokens: toNonNegInt(lastUsage.output_tokens),
            reasoningOutputTokens: toNonNegInt(lastUsage.reasoning_output_tokens),
          };
          const usageKey = codexUsageEdgeKey(currentTotals, last);
          if (seenUsageKeys.has(usageKey)) {
            rawDelta = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
          } else {
            seenUsageKeys.add(usageKey);
            usageKeys.push(usageKey);
            rawDelta = last;
          }
        } else {
          // Backward-compatible fallback for very old rollouts that predate
          // last_token_usage. Those logs can only be diffed heuristically.
          rawDelta = useHighWater
            ? highWaterTotals
              ? diffHighWater(currentTotals, highWaterTotals)
              : { ...currentTotals }
            : lastTotals
              ? diffTotals(currentTotals, lastTotals)
              : { ...currentTotals };
        }
        if (useHighWater) {
          highWaterTotals = highWaterTotals
            ? mergeHighWater(currentTotals, highWaterTotals)
            : { ...currentTotals };
        }
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

  return { deltas, endOffset, lastTotals, lastModel, highWaterTotals, usageKeys };
}

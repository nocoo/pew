/**
 * WorkBuddy session JSONL parser.
 *
 * WorkBuddy (Tencent) writes one JSONL file per session at
 * `~/.workbuddy/projects/<slug>/<sessionId>.jsonl`. Token usage rides on the
 * `providerData` of `function_call` and `message` records, in three
 * numerically-identical shapes; `providerData.rawUsage` is the richest and is
 * the primary source here, with the camelCase `usage` and Anthropic-shaped
 * `message.usage` accepted as fallbacks.
 *
 * Two traps this parser must not fall into (both verified against real
 * installs):
 *  - `cache_read_input_tokens` and the top-level `cached_tokens` are stale
 *    zeros; the live cache-read count is `prompt_cache_hit_tokens` (or
 *    `prompt_tokens_details.cached_tokens`).
 *  - `prompt_tokens` already includes the cache read, and
 *    `completion_tokens` already includes the reasoning tokens, so both must
 *    be subtracted before they reach the disjoint TokenDelta buckets.
 *
 * Dedup key is `providerData.messageId`: one API request emits exactly one
 * usage record, though a request's id also appears on sibling rows
 * (`reasoning`, `function_call_result`). `conversationRequestId`/`traceId`
 * are turn-scoped and must never be used to count requests.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { TokenDelta } from "@pew/core";
import { inclusiveAccounting } from "../utils/accounting.js";
import { jsonlCompleteBound } from "../utils/jsonl-offset.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import type { ParsedDelta } from "./claude.js";

/** Result of parsing a single WorkBuddy JSONL file */
export interface WorkbuddyFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
}

/** Raw counter fields extracted from one usage object. */
export interface WorkbuddyCounters {
  /** Inclusive prompt total (cache read included) */
  promptTokens: number;
  /** Cache read tokens */
  read: number;
  /** Uncached, non-creation input tokens */
  miss: number;
  /** Cache creation/write tokens */
  write: number;
  /** Inclusive completion total (reasoning included) */
  completion: number;
  /** Reasoning tokens, a subset of `completion` */
  reasoning: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * First positive integer among `values`, else 0.
 *
 * WorkBuddy carries several aliases for the same counter and pads the unused
 * ones with zeros, so a plain "first present" read reports 0% cache hit rate.
 * The value that matters is whichever alias is actually populated.
 */
function firstPositive(values: unknown[]): number {
  for (const value of values) {
    const n = toNonNegInt(value);
    if (n > 0) return n;
  }
  return 0;
}

/** Pull the raw counters out of one usage object (any of the three shapes). */
export function readWorkbuddyCounters(raw: Record<string, unknown>): WorkbuddyCounters {
  const promptDetails = asRecord(raw.prompt_tokens_details);
  const completionDetails = asRecord(raw.completion_tokens_details);
  const inputDetails = Array.isArray(raw.inputTokensDetails) ? raw.inputTokensDetails : [];
  const outputDetails = Array.isArray(raw.outputTokensDetails) ? raw.outputTokensDetails : [];

  const promptTokens = toNonNegInt(raw.prompt_tokens) || toNonNegInt(raw.inputTokens) || toNonNegInt(raw.input_tokens);
  const read = firstPositive([
    raw.prompt_cache_hit_tokens,
    promptDetails?.cached_tokens,
    asRecord(inputDetails[0])?.cached_tokens,
    raw.cache_read_input_tokens,
    raw.cached_tokens,
  ]);
  const miss = toNonNegInt(raw.prompt_cache_miss_tokens) || Math.max(0, promptTokens - read);
  const write = firstPositive([raw.cache_creation_input_tokens, raw.prompt_cache_write_tokens]);
  const completion = toNonNegInt(raw.completion_tokens) || toNonNegInt(raw.outputTokens) || toNonNegInt(raw.output_tokens);
  const reasoning = firstPositive([
    completionDetails?.reasoning_tokens,
    raw.completion_thinking_tokens,
    asRecord(outputDetails[0])?.reasoning_tokens,
  ]);

  return { promptTokens, read, miss, write, completion, reasoning };
}

/**
 * Normalize WorkBuddy's inclusive usage counters to pew's disjoint TokenDelta.
 *
 *   prompt - cacheRead (+ cacheWrite) → inputTokens
 *   cacheRead                         → cachedInputTokens
 *   completion - reasoning            → outputTokens
 *   reasoning                         → reasoningOutputTokens
 */
export function normalizeWorkbuddyUsage(raw: Record<string, unknown>): TokenDelta {
  const c = readWorkbuddyCounters(raw);
  return {
    inputTokens: c.miss + c.write,
    cachedInputTokens: c.read,
    outputTokens: Math.max(0, c.completion - c.reasoning),
    reasoningOutputTokens: c.reasoning,
  };
}

/**
 * Parse a WorkBuddy session JSONL file incrementally from a byte offset.
 *
 * Each record whose `providerData` carries usage produces one delta. Records
 * repeating a `messageId` already emitted in this parse are skipped — the
 * observed layout emits usage once per request, but newer builds are reported
 * to repeat it across sibling rows.
 */
export async function parseWorkbuddyFile(opts: {
  filePath: string;
  startOffset: number;
  endBound?: number;
  includeAccounting?: boolean;
}): Promise<WorkbuddyFileResult> {
  const deltas: ParsedDelta[] = [];

  const st = await stat(opts.filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: opts.startOffset };

  const endOffset = await jsonlCompleteBound(
    opts.filePath,
    opts.startOffset,
    st.size,
    opts.endBound,
  );
  if (opts.startOffset >= endOffset) return { deltas, endOffset };

  const seenMessageIds = new Set<string>();
  const stream = createReadStream(opts.filePath, {
    encoding: "utf8",
    start: opts.startOffset,
    end: endOffset - 1,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line?.includes('"usage"')) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const providerData = asRecord(obj.providerData);
      if (!providerData) continue;

      const message = asRecord(obj.message);
      const raw =
        asRecord(providerData.rawUsage) ??
        asRecord(message?.usage) ??
        asRecord(providerData.usage);
      if (!raw) continue;

      const model =
        typeof providerData.model === "string" ? providerData.model.trim() : "";
      if (!model) continue;

      // WorkBuddy timestamps are integer epoch milliseconds. A non-numeric
      // value means the row is not a usage event we can place in time.
      const tsMs = typeof obj.timestamp === "number" && Number.isFinite(obj.timestamp)
        ? obj.timestamp
        : null;
      if (tsMs === null) continue;

      const messageId =
        typeof providerData.messageId === "string" && providerData.messageId.length > 0
          ? providerData.messageId
          : null;
      if (messageId && seenMessageIds.has(messageId)) continue;

      const tokens = normalizeWorkbuddyUsage(raw);
      // Zero-usage stubs must not occupy the messageId slot and suppress a
      // later real row carrying the same id.
      if (isAllZero(tokens)) continue;
      if (messageId) seenMessageIds.add(messageId);

      const counters = readWorkbuddyCounters(raw);
      deltas.push({
        source: "workbuddy",
        model,
        timestamp: new Date(tsMs).toISOString(),
        tokens,
        ...(opts.includeAccounting
          ? {
              accounting: inclusiveAccounting(
                tokens,
                {
                  // Basis sum, so the counts invariant holds by construction;
                  // the raw prompt total rides along as the rawTotal diagnostic.
                  input: tokens.inputTokens + tokens.cachedInputTokens,
                  uncachedInput: counters.miss,
                  read: counters.read,
                  write: counters.write,
                  output: counters.completion,
                  reasoning: counters.reasoning,
                },
                { origin: "workbuddy:usage", model, rawTotal: raw.total_tokens },
              ),
            }
          : {}),
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { deltas, endOffset };
}

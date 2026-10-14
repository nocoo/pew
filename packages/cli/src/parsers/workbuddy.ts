/**
 * WorkBuddy token JSONL parser.
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
import { isValidISODate, MAX_RECORD_TOKENS, MAX_STRING_LENGTH, type TokenDelta } from "@pew/core";
import { inclusiveAccounting } from "../utils/accounting.js";
import { jsonlCompleteBound } from "../utils/jsonl-offset.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import { isRepresentableEpochMs } from "../utils/time.js";
import type { ParsedDelta } from "./claude.js";

/** Result of parsing a single WorkBuddy JSONL file */
export interface WorkbuddyFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
  /**
   * `providerData.messageId` values this parse actually emitted, in emission
   * order (no duplicates). Recorded whether or not the caller passed an
   * external `seenMessageIds` set, so the driver can fold them onto the cursor.
   */
  emittedMessageIds: string[];
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

/** Like `asRecord`, but an empty object counts as absent so the caller falls
 * through to the next usage shape instead of normalizing `{}` to all zeros. */
function asNonEmptyRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record && Object.keys(record).length > 0 ? record : null;
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
 *
 * `seenMessageIds` extends that dedup across files and syncs: an id already
 * in the set is suppressed, and every newly-emitted id is added to it. Pass
 * the set you get from `SyncContext` (lifted from the cursor rings by the
 * driver's `preload`) to stop a request replayed into a sibling file — a
 * session copy across the domestic and international roots, or an in-place
 * re-emission past the cursor — from being counted again. The ids this call
 * emitted are returned in `emittedMessageIds` so the driver can fold them
 * back onto the cursor.
 */
export async function parseWorkbuddyFile(opts: {
  filePath: string;
  startOffset: number;
  endBound?: number;
  includeAccounting?: boolean;
  seenMessageIds?: Set<string>;
}): Promise<WorkbuddyFileResult> {
  const deltas: ParsedDelta[] = [];
  const emittedMessageIds: string[] = [];

  const st = await stat(opts.filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: opts.startOffset, emittedMessageIds };

  const endOffset = await jsonlCompleteBound(
    opts.filePath,
    opts.startOffset,
    st.size,
    opts.endBound,
  );
  if (opts.startOffset >= endOffset) return { deltas, endOffset, emittedMessageIds };

  // The caller's cross-file/cross-sync set when provided; otherwise a
  // local-only set so within-file dedup still holds.
  const seenMessageIds = opts.seenMessageIds ?? new Set<string>();
  const stream = createReadStream(opts.filePath, {
    encoding: "utf8",
    start: opts.startOffset,
    end: endOffset - 1,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      // Cheap pre-filter: a usage row carries `rawUsage`, `providerData.usage`
      // or `message.usage` — match all three shapes so a line whose only usage
      // is `rawUsage` is not silently skipped.
      if (!line?.includes('"usage"') && !line?.includes('"rawUsage"')) continue;

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
        asNonEmptyRecord(providerData.rawUsage) ??
        asNonEmptyRecord(message?.usage) ??
        asNonEmptyRecord(providerData.usage);
      if (!raw) continue;

      const model =
        typeof providerData.model === "string" ? providerData.model.trim() : "";
      if (!model) continue;
      // The server rejects a `model` over MAX_STRING_LENGTH with a 400, and the
      // upload engine does not retry or skip a 4xx — one over-long row would
      // wedge every later upload. Drop the row here instead.
      if (model.length > MAX_STRING_LENGTH) continue;

      // WorkBuddy timestamps are integer epoch milliseconds. A non-numeric
      // value, or one outside the representable Date range, means the row is
      // not a usage event we can place in time.
      const tsMs =
        typeof obj.timestamp === "number" && isRepresentableEpochMs(obj.timestamp)
          ? obj.timestamp
          : null;
      if (tsMs === null) continue;

      const messageId =
        typeof providerData.messageId === "string" && providerData.messageId.length > 0
          ? providerData.messageId
          : null;
      if (messageId && seenMessageIds.has(messageId)) continue;

      const counters = readWorkbuddyCounters(raw);
      const iso = new Date(tsMs).toISOString();
      // The server's ISO regex only accepts a 4-digit year, while
      // isRepresentableEpochMs allows ±275,760 years. A representable-but-
      // far-future timestamp would format as `+160413-…Z`, 400 the batch, and
      // wedge every later upload, so gate on the server's own rule. Checked
      // before the id is claimed: like zero-usage stubs, a row dropped here
      // must not occupy the messageId slot and permanently suppress a later
      // corrected rewrite of the same request.
      if (!isValidISODate(iso)) continue;

      const tokens = normalizeWorkbuddyUsage(raw);
      // The server rejects any token field over MAX_RECORD_TOKENS with a 400,
      // and the upload engine does not retry a 4xx — queueing an over-cap
      // row would wedge every later upload for the account. Aliased inclusive
      // counters can cross the cap even when each raw field stays under it,
      // so the check runs on the composed buckets.
      if (tokens.inputTokens > MAX_RECORD_TOKENS ||
        tokens.cachedInputTokens > MAX_RECORD_TOKENS ||
        tokens.outputTokens > MAX_RECORD_TOKENS ||
        tokens.reasoningOutputTokens > MAX_RECORD_TOKENS) continue;
      // Zero-usage stubs must not occupy the messageId slot and suppress a
      // later real row carrying the same id.
      if (isAllZero(tokens)) continue;
      if (messageId) {
        seenMessageIds.add(messageId);
        emittedMessageIds.push(messageId);
      }

      deltas.push({
        source: "workbuddy",
        model,
        timestamp: iso,
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

  return { deltas, endOffset, emittedMessageIds };
}

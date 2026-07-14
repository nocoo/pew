import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Source, TokenDelta } from "@pew/core";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

/** A parsed token delta with metadata for bucket aggregation */
export interface ParsedDelta {
  source: Source;
  model: string;
  timestamp: string;
  tokens: TokenDelta;
}

/** Result of parsing a single Claude JSONL file */
export interface ClaudeFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
  /**
   * `message.id` values that produced an emitted delta on this parse call.
   * Callers persist this into the cursor so a later sync's incremental read
   * can suppress an appended duplicate line that would otherwise re-count
   * the same assistant turn.
   */
  emittedIds: string[];
}

/**
 * Normalize Claude's usage object to our TokenDelta format.
 *
 * Claude API fields:
 *   input_tokens + cache_creation_input_tokens → inputTokens
 *   cache_read_input_tokens                    → cachedInputTokens
 *   output_tokens                              → outputTokens
 *   (hardcoded 0)                              → reasoningOutputTokens
 */
export function normalizeClaudeUsage(u: Record<string, unknown>): TokenDelta {
  return {
    inputTokens:
      toNonNegInt(u?.input_tokens) +
      toNonNegInt(u?.cache_creation_input_tokens),
    cachedInputTokens: toNonNegInt(u?.cache_read_input_tokens),
    outputTokens: toNonNegInt(u?.output_tokens),
    reasoningOutputTokens: 0,
  };
}

/**
 * Parse a Claude Code JSONL file incrementally from a byte offset.
 *
 * Each assistant message with non-zero usage produces a standalone delta
 * (no running-total diffing needed — each usage block is absolute).
 *
 * If `seenMessageIds` is provided, lines whose `message.id` is already in the
 * Set are skipped, and newly-seen ids are added to it. This is the caller's
 * dedup contract: Claude Code can write the same assistant message multiple
 * times (streaming retries, crash-resumes, subagent parent/child sharing),
 * and each id must only count once per sync. Lines without a `message.id`
 * are always kept (no id → no basis for dedup, and missing-id assistant
 * messages are rare but real).
 */
export async function parseClaudeFile(opts: {
  filePath: string;
  startOffset: number;
  seenMessageIds?: Set<string>;
}): Promise<ClaudeFileResult> {
  const { filePath, startOffset, seenMessageIds } = opts;
  const deltas: ParsedDelta[] = [];
  const emittedIds: string[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: startOffset, emittedIds };

  const endOffset = st.size;
  if (startOffset >= endOffset) return { deltas, endOffset, emittedIds };

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      // Fast-path: skip lines that can't contain usage data
      if (!line?.includes('"usage"')) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      // Extract usage from message.usage or obj.usage
      const msg = obj?.message as Record<string, unknown> | undefined;
      const usage = (msg?.usage || obj?.usage) as
        | Record<string, unknown>
        | undefined;
      if (!usage || typeof usage !== "object") continue;

      // Extract model
      const model =
        typeof (msg?.model ?? obj?.model) === "string"
          ? String(msg?.model ?? obj?.model).trim()
          : null;
      if (!model) continue;

      // Extract timestamp
      const timestamp =
        typeof obj?.timestamp === "string" ? obj.timestamp : null;
      if (!timestamp) continue;

      const id = typeof msg?.id === "string" ? msg.id : null;

      // Dedup gate: an id already emitted in this sync-context is a duplicate
      // that must be suppressed. Absent id → cannot dedup safely, always keep.
      if (id && seenMessageIds?.has(id)) continue;

      // Normalize and filter zero deltas. Do this BEFORE marking the id as
      // seen — a zero-usage stub row must not occupy the id slot and cause
      // the real usage row (same id, later in the file) to be dropped.
      const delta = normalizeClaudeUsage(usage);
      if (isAllZero(delta)) continue;

      // Emit + record. Only real, non-zero deltas mark an id as seen.
      if (id) {
        seenMessageIds?.add(id);
        emittedIds.push(id);
      }
      deltas.push({
        source: "claude-code",
        model,
        timestamp,
        tokens: delta,
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { deltas, endOffset, emittedIds };
}

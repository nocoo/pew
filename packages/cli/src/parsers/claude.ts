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
 */
export async function parseClaudeFile(opts: {
  filePath: string;
  startOffset: number;
}): Promise<ClaudeFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile()) return { deltas, endOffset: startOffset };

  const endOffset = st.size;
  if (startOffset >= endOffset) return { deltas, endOffset };

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      // Fast-path: skip lines that can't contain usage data
      if (!line || !line.includes('"usage"')) continue;

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

      // Normalize and filter zero deltas
      const delta = normalizeClaudeUsage(usage);
      if (isAllZero(delta)) continue;

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

  return { deltas, endOffset };
}

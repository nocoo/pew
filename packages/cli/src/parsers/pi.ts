import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

/** Result of parsing a single pi-format JSONL session file */
export interface PiFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
}

/**
 * Normalize pi's usage object to our TokenDelta format.
 *
 * Pi session JSONL assistant messages carry per-turn absolute usage:
 *   input + cacheWrite  → inputTokens
 *   cacheRead           → cachedInputTokens
 *   output              → outputTokens
 *   (hardcoded 0)       → reasoningOutputTokens
 *
 * Note: pi's `input` field counts non-cached input tokens and `cacheWrite`
 * counts tokens written to the cache (analogous to Anthropic's
 * `cache_creation_input_tokens`). Together they represent total input.
 * The invariant `totalTokens === input + output + cacheRead + cacheWrite`
 * holds for every row, so this mapping never double-counts.
 *
 * `reasoning` (pi-only, absent in omp) is a subset of `output` — folding it
 * in would double-count, so reasoning is reported as 0.
 */
export function normalizePiUsage(u: Record<string, unknown>): TokenDelta {
  return {
    inputTokens:
      toNonNegInt(u?.input) + toNonNegInt(u?.cacheWrite),
    cachedInputTokens: toNonNegInt(u?.cacheRead),
    outputTokens: toNonNegInt(u?.output),
    reasoningOutputTokens: 0,
  };
}

/**
 * Parse a pi-format JSONL session file incrementally from a byte offset.
 *
 * Pi stores one JSONL file per session under ~/.pi/agent/sessions/<encoded-cwd>/.
 * Oh My Pi (omp) is a fork that writes the identical schema under
 * ~/.omp/agent/sessions/<encoded-cwd>/ — `source` selects which one is tagged.
 *
 * Each line is a JSON object with a `type` field. Assistant messages have
 * `type: "message"` with `message.role === "assistant"` and a `message.usage`
 * object containing per-turn absolute token counts.
 *
 * Strategy: Byte-offset streaming (same as Claude Code).
 * Each usage block is standalone — no running-total diffing needed.
 */
export async function parsePiFile(opts: {
  filePath: string;
  startOffset: number;
  /** Source tag for emitted deltas — "pi" (default) or "omp" */
  source?: Source;
}): Promise<PiFileResult> {
  const { filePath, startOffset, source = "pi" } = opts;
  const deltas: ParsedDelta[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: startOffset };

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
      if (!line?.includes('"usage"')) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      // Only process assistant messages
      if (obj?.type !== "message") continue;

      const msg = obj.message as Record<string, unknown> | undefined;
      if (msg?.role !== "assistant") continue;

      // Extract usage
      const usage = msg.usage as Record<string, unknown> | undefined;
      if (!usage || typeof usage !== "object") continue;

      // Extract model
      const model =
        typeof msg.model === "string" ? msg.model.trim() : null;
      if (!model) continue;

      // Extract timestamp from the outer JSONL entry
      const timestamp =
        typeof obj.timestamp === "string" ? obj.timestamp : null;
      if (!timestamp) continue;

      // Normalize and filter zero deltas
      const delta = normalizePiUsage(usage);
      if (isAllZero(delta)) continue;

      deltas.push({
        source,
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

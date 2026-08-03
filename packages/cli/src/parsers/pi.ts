import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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
 * Strategy: byte-offset streaming, bounded to the `stat()` snapshot so a
 * concurrent append is never parsed under a cursor that predates it.
 * Partial-line safe: `endOffset` stops after the last complete `\n`, so a
 * half-written trailing line is retried on the next sync instead of being
 * skipped forever. Each usage block is standalone — no running-total diffing.
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
  if (startOffset >= st.size) return { deltas, endOffset: startOffset };

  // `end` is inclusive — pin the read to the stat snapshot so bytes appended
  // mid-parse stay unread (and unaccounted) until the next run.
  const stream = createReadStream(filePath, { start: startOffset, end: st.size - 1 });
  // Carry incomplete trailing bytes across chunks (Uint8Array avoids Buffer generics)
  let pending: Uint8Array = new Uint8Array(0);
  // Bytes of complete lines (ending in \n) consumed relative to startOffset
  let completeBytes = 0;

  try {
    for await (const chunk of stream) {
      const piece: Uint8Array = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string);
      if (pending.length === 0) {
        pending = piece;
      } else {
        const merged = new Uint8Array(pending.length + piece.length);
        merged.set(pending, 0);
        merged.set(piece, pending.length);
        pending = merged;
      }

      let offset = 0;
      while (offset < pending.length) {
        const nl = pending.indexOf(0x0a, offset);
        if (nl === -1) break;

        const lineBuf = pending.subarray(offset, nl);
        completeBytes += nl - offset + 1; // include \n
        offset = nl + 1;

        if (lineBuf.length === 0) continue;
        const line = Buffer.from(lineBuf).toString("utf8");

        // Fast-path: skip lines that can't contain usage data
        if (!line.includes('"usage"')) continue;

        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Malformed but terminated line — skip and advance past it
          continue;
        }

        // Only process assistant messages
        if (obj.type !== "message") continue;

        const msg = obj.message as Record<string, unknown> | undefined;
        if (msg?.role !== "assistant") continue;

        // Extract usage
        const usage = msg.usage as Record<string, unknown> | undefined;
        if (!usage || typeof usage !== "object") continue;

        // Extract model
        const model = typeof msg.model === "string" ? msg.model.trim() : null;
        if (!model) continue;

        // Extract timestamp from the outer JSONL entry
        const timestamp =
          typeof obj.timestamp === "string" ? obj.timestamp : null;
        if (!timestamp) continue;

        // Normalize and filter zero deltas
        const delta = normalizePiUsage(usage);
        if (isAllZero(delta)) continue;

        deltas.push({ source, model, timestamp, tokens: delta });
      }

      // Keep only the trailing partial line
      pending = offset === 0 ? pending : pending.subarray(offset);
    }
  } finally {
    stream.destroy();
  }

  // Trailing partial line is NOT counted in endOffset
  return { deltas, endOffset: startOffset + completeBytes };
}

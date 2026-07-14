import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

/** Result of parsing an OpenClaw JSONL session file */
export interface OpenClawFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
}

/**
 * Parse an OpenClaw session JSONL file incrementally from a byte offset.
 *
 * OpenClaw writes one JSONL line per event. We look for `type: "message"`
 * lines with `message.usage` containing absolute token counts (no diffing needed).
 *
 * OpenClaw normalization (aligned with Claude/Pi parsers to avoid double-counting
 * cacheRead in the downstream `total = inputTokens + cachedInputTokens + ...` formula):
 *   input + cacheWrite → inputTokens       (non-cached input + cache fills)
 *   cacheRead          → cachedInputTokens (cache hits only)
 *   output             → outputTokens
 *   (hardcoded 0)      → reasoningOutputTokens
 *
 * NOTE: `usage.input` is only the uncached token delta (typically 1–3 per turn);
 * cacheWrite is the cache-fill cost. Together they form the non-cached input.
 * cacheRead must NOT appear in inputTokens — it is reported separately via
 * cachedInputTokens, and the sync layer adds the two for the final total.
 */
export async function parseOpenClawFile(opts: {
  filePath: string;
  startOffset: number;
}): Promise<OpenClawFileResult> {
  const { filePath, startOffset } = opts;
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
      if (!line) continue;
      // Fast-path: OpenClaw messages include "usage" and "totalTokens"
      if (!line.includes('"usage"') || !line.includes("totalTokens")) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      if (obj?.type !== "message") continue;

      const msg = obj?.message as Record<string, unknown> | undefined;
      if (!msg || typeof msg !== "object") continue;

      const usage = msg.usage as Record<string, unknown> | undefined;
      if (!usage || typeof usage !== "object") continue;

      const timestamp =
        typeof obj?.timestamp === "string" ? obj.timestamp : null;
      if (!timestamp) continue;

      const model =
        typeof msg.model === "string" ? msg.model.trim() : "unknown";

      const tokens: TokenDelta = {
        inputTokens:
          toNonNegInt(usage.input) + toNonNegInt(usage.cacheWrite),
        cachedInputTokens: toNonNegInt(usage.cacheRead),
        outputTokens: toNonNegInt(usage.output),
        reasoningOutputTokens: 0,
      };

      if (isAllZero(tokens)) continue;

      deltas.push({
        source: "openclaw" as Source,
        model,
        timestamp,
        tokens,
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { deltas, endOffset };
}

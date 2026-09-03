/**
 * GitHub Copilot CLI OpenTelemetry JSONL parser.
 *
 * Copilot's file exporter writes one OTel signal per line. GenAI chat spans
 * carry request token fields using the OTel semantic conventions.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import { clampedJsonlEndOffset, jsonlStreamBound } from "../utils/jsonl-offset.js";

export interface CopilotOtelFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
}

function timestampFromSpan(span: Record<string, unknown>): string | null {
  const value = span.startTime;
  if (Array.isArray(value) && value.length >= 1) {
    const seconds = Number(value[0]);
    const nanos = Number(value[1] ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) {
      return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
    }
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function extractUsageDelta(span: Record<string, unknown>): ParsedDelta | null {
  if (span.type !== "span") return null;
  const attrs = span.attributes as Record<string, unknown> | undefined;
  if (!attrs) return null;
  const provider = attrs["gen_ai.provider.name"];
  const instrumentation = span.instrumentationScope as Record<string, unknown> | undefined;
  if (provider !== "github" && instrumentation?.name !== "github.copilot") return null;

  const totalInput = toNonNegInt(attrs["gen_ai.usage.input_tokens"]);
  const cachedInput = Math.min(
    totalInput,
    toNonNegInt(attrs["gen_ai.usage.cache_read.input_tokens"]),
  );
  const totalOutput = toNonNegInt(attrs["gen_ai.usage.output_tokens"]);
  const reasoningOutput = Math.min(
    totalOutput,
    toNonNegInt(attrs["gen_ai.usage.reasoning.output_tokens"]),
  );
  const tokens: TokenDelta = {
    inputTokens: Math.max(0, totalInput - cachedInput),
    cachedInputTokens: cachedInput,
    outputTokens: Math.max(0, totalOutput - reasoningOutput),
    reasoningOutputTokens: reasoningOutput,
  };
  if (isAllZero(tokens)) return null;

  const timestamp = timestampFromSpan(span);
  if (!timestamp) return null;
  const fallbackName = typeof span.name === "string"
    ? span.name.replace(/^chat\s+/i, "")
    : "unknown";
  const model = attrs["gen_ai.response.model"]
    ?? attrs["gen_ai.request.model"]
    ?? fallbackName;
  return {
    source: "copilot-cli" as Source,
    model: typeof model === "string" && model.length > 0 ? model : "unknown",
    timestamp,
    tokens,
  };
}

/**
 * Parse complete JSONL records from a byte offset.
 *
 * Byte-accurate and partial-line safe, the same contract the Codex/Grok
 * parsers use:
 *   - the read is pinned to the `stat()` snapshot (`end: size - 1`), so spans
 *     appended while the parse is in flight are neither emitted now nor
 *     re-emitted next run;
 *   - `endOffset` advances only past complete `\n`-terminated lines, measured
 *     in real bytes, so a half-written trailing record is retried instead of
 *     being skipped forever.
 *
 * Line terminators are counted per line (not guessed once from the file head),
 * which keeps the offset exact for mixed or CRLF endings.
 */
export async function parseCopilotOtelFile(opts: {
  filePath: string;
  startOffset: number;
  endBound?: number;
}): Promise<CopilotOtelFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) {
    return { deltas, endOffset: startOffset };
  }
  const bound = jsonlStreamBound(st.size, opts.endBound);
  if (startOffset >= bound) {
    return { deltas, endOffset: bound };
  }

  // `end` is inclusive — pin the read to the snapshot bound.
  const stream = createReadStream(filePath, { start: startOffset, end: bound - 1 });
  // Carry incomplete trailing bytes across chunks (Uint8Array avoids Buffer generics)
  let pending: Uint8Array = new Uint8Array(0);
  // Bytes of complete lines (ending in \n) consumed relative to startOffset
  let completeBytes = 0;
  const seenSpanIds = new Set<string>();

  function consume(line: string): void {
    if (!line.trim()) return;
    let span: Record<string, unknown>;
    try {
      span = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Malformed but terminated line — skip it and advance past it.
      return;
    }
    const traceId = typeof span.traceId === "string" ? span.traceId : "";
    const spanId = typeof span.spanId === "string" ? span.spanId : "";
    const id = traceId || spanId ? `${traceId}:${spanId}` : null;
    if (id) {
      if (seenSpanIds.has(id)) return;
      seenSpanIds.add(id);
    }
    const delta = extractUsageDelta(span);
    if (delta) deltas.push(delta);
  }

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

        // Trim a CR so CRLF files parse, while its byte stays counted above.
        const end = lineBuf.length > 0 && lineBuf[lineBuf.length - 1] === 0x0d
          ? lineBuf.length - 1
          : lineBuf.length;
        if (end === 0) continue;
        consume(Buffer.from(lineBuf.subarray(0, end)).toString("utf8"));
      }

      // Keep only the trailing partial line
      pending = offset === 0 ? pending : pending.subarray(offset);
    }
  } finally {
    stream.destroy();
  }

  // Trailing partial line is NOT counted in endOffset
  return { deltas, endOffset: clampedJsonlEndOffset(startOffset, bound, completeBytes) };
}

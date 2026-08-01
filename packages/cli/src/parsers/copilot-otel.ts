/**
 * GitHub Copilot CLI OpenTelemetry JSONL parser.
 *
 * Copilot's file exporter writes one OTel signal per line. GenAI chat spans
 * carry request token fields using the OTel semantic conventions.
 */

import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

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

/** Parse complete JSONL records from a byte offset, retaining partial tails. */
export async function parseCopilotOtelFile(opts: {
  filePath: string;
  startOffset: number;
}): Promise<CopilotOtelFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile() || startOffset >= st.size) {
    return { deltas, endOffset: startOffset };
  }

  const eolBytes = await detectEolSize(filePath);
  const stream = createReadStream(filePath, { start: startOffset, encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const seenSpanIds = new Set<string>();
  let bytesConsumed = 0;
  let endOffset = startOffset;

  function consume(line: string): boolean {
    if (!line.trim()) return true;
    let span: Record<string, unknown>;
    try {
      span = JSON.parse(line);
    } catch {
      return false;
    }
    const traceId = typeof span.traceId === "string" ? span.traceId : "";
    const spanId = typeof span.spanId === "string" ? span.spanId : "";
    const id = traceId || spanId ? `${traceId}:${spanId}` : null;
    if (id && seenSpanIds.has(id)) return true;
    if (id) seenSpanIds.add(id);
    const delta = extractUsageDelta(span);
    if (delta) deltas.push(delta);
    return true;
  }

  try {
    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line, "utf8");
      const contentEnd = startOffset + bytesConsumed + lineBytes;
      bytesConsumed += lineBytes + (contentEnd < st.size ? eolBytes : 0);
      if (consume(line)) endOffset = Math.min(st.size, startOffset + bytesConsumed);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { deltas, endOffset };
}

async function detectEolSize(filePath: string): Promise<number> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0x0a) return i > 0 && buf[i - 1] === 0x0d ? 2 : 1;
    }
    return 1;
  } finally {
    await fh.close();
  }
}

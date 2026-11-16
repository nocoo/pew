import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import type { TokenDelta } from "@pew/core";
import { clampedJsonlEndOffset, jsonlStreamBound } from "../utils/jsonl-offset.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import type { ParsedDelta } from "./claude.js";

/** Result of parsing a single GitHub Copilot CLI process log file */
export interface CopilotCliFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
  apiCallIds: string[];
}

/**
 * Parse a GitHub Copilot CLI process log file incrementally from a byte offset.
 *
 * Log format: Each telemetry block starts with a line containing
 * `[Telemetry] cli.telemetry:` followed by a multi-line JSON object.
 * We extract `assistant_usage` events which carry per-request token counts.
 *
 * Token fields (disjoint for estimateCost / total_tokens SUM):
 *   metrics.input_tokens_uncached → inputTokens (preferred)
 *   else max(0, input_tokens - cache_read_tokens)
 *   metrics.cache_read_tokens     → cachedInputTokens
 *   metrics.output_tokens         → outputTokens
 *
 * `input_tokens` from the telemetry is the total including cache hits;
 * storing it alongside cache_read would double-count.
 */
export async function parseCopilotCliFile(opts: {
  filePath: string;
  startOffset: number;
  endBound?: number;
  seenApiCallIds?: Set<string>;
}): Promise<CopilotCliFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: startOffset, apiCallIds: [] };
  const bound = jsonlStreamBound(st.size, opts.endBound);
  if (startOffset >= bound) return { deltas, endOffset: bound, apiCallIds: [] };
  const seenApiCallIds = opts.seenApiCallIds ?? new Set<string>();
  const apiCallIds = new Set<string>();
  if (filePath.endsWith(".jsonl") && !basename(filePath).startsWith("process-")) {
    return parseUsageJsonl({ filePath, startOffset, bound, deltas, seenApiCallIds, apiCallIds });
  }
  return parseLegacyProcessLog({ filePath, startOffset, bound, deltas, seenApiCallIds, apiCallIds });
}

async function parseUsageJsonl(opts: {
  filePath: string;
  startOffset: number;
  bound: number;
  deltas: ParsedDelta[];
  seenApiCallIds: Set<string>;
  apiCallIds: Set<string>;
}): Promise<CopilotCliFileResult> {
  const stream = createReadStream(opts.filePath, { start: opts.startOffset, end: opts.bound - 1 });
  let pending = Buffer.alloc(0);
  let completeBytes = 0;
  const consume = (line: string): void => {
    if (!line.trim()) return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { return; }
    if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).type !== "session.usage_record") return;
    const extracted = extractUsageDelta(parsed as Record<string, unknown>, true);
    if (!extracted) return;
    if (extracted.apiCallId && opts.seenApiCallIds.has(extracted.apiCallId)) return;
    if (extracted.apiCallId) {
      opts.seenApiCallIds.add(extracted.apiCallId);
      opts.apiCallIds.add(extracted.apiCallId);
    }
    opts.deltas.push(extracted.delta);
  };
  try {
    for await (const chunk of stream) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      pending = pending.length === 0 ? piece : Buffer.concat([pending, piece]);
      let offset = 0;
      while (offset < pending.length) {
        const nl = pending.indexOf(0x0a, offset);
        if (nl === -1) break;
        const line = pending.subarray(offset, nl);
        completeBytes += nl - offset + 1;
        offset = nl + 1;
        const end = line.length > 0 && line[line.length - 1] === 0x0d ? line.length - 1 : line.length;
        if (end > 0) consume(line.subarray(0, end).toString("utf8"));
      }
      pending = offset === 0 ? pending : pending.subarray(offset);
    }
  } finally { stream.destroy(); }
  return {
    deltas: opts.deltas,
    endOffset: clampedJsonlEndOffset(opts.startOffset, opts.bound, completeBytes),
    apiCallIds: [...opts.apiCallIds],
  };
}

async function parseLegacyProcessLog(opts: {
  filePath: string;
  startOffset: number;
  bound: number;
  deltas: ParsedDelta[];
  seenApiCallIds: Set<string>;
  apiCallIds: Set<string>;
}): Promise<CopilotCliFileResult> {
  const eolBytes = await detectEolSize(opts.filePath);
  const stream = createReadStream(opts.filePath, { start: opts.startOffset, end: opts.bound - 1, encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const LOG_LINE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const TELEMETRY_MARKER = "[Telemetry] cli.telemetry:";
  let collectingJson = false;
  let jsonLines: string[] = [];
  let bytesConsumed = 0;
  let lastCompletedOffset = opts.startOffset;
  const emit = (parsed: Record<string, unknown>): void => {
    if (parsed.kind !== "assistant_usage") return;
    const extracted = extractUsageDelta(parsed, false);
    if (!extracted) return;
    if (extracted.apiCallId && opts.seenApiCallIds.has(extracted.apiCallId)) return;
    if (extracted.apiCallId) {
      opts.seenApiCallIds.add(extracted.apiCallId);
      opts.apiCallIds.add(extracted.apiCallId);
    }
    opts.deltas.push(extracted.delta);
  };
  function tryFlushJson(): boolean {
    if (jsonLines.length === 0) return true;
    try { emit(JSON.parse(jsonLines.join("\n")) as Record<string, unknown>); jsonLines = []; return true; }
    catch { return false; }
  }
  try {
    for await (const line of rl) {
      bytesConsumed += Buffer.byteLength(line, "utf8") + eolBytes;
      if (LOG_LINE_RE.test(line)) {
        if (collectingJson) { tryFlushJson(); jsonLines = []; collectingJson = false; }
        if (line.includes(TELEMETRY_MARKER)) collectingJson = true;
        else lastCompletedOffset = opts.startOffset + bytesConsumed;
        continue;
      }
      if (collectingJson) {
        jsonLines.push(line);
        if (line.includes("}") && tryFlushJson()) { collectingJson = false; lastCompletedOffset = opts.startOffset + bytesConsumed; }
      }
    }
  } finally { rl.close(); stream.destroy(); }
  return {
    deltas: opts.deltas,
    endOffset: collectingJson && jsonLines.length > 0 ? lastCompletedOffset : opts.startOffset + bytesConsumed,
    apiCallIds: [...opts.apiCallIds],
  };
}

function extractUsageDelta(event: Record<string, unknown>, jsonl: boolean): { delta: ParsedDelta; apiCallId: string | null } | null {
  const usage = (jsonl ? (event.data as Record<string, unknown> | undefined)?.usage ?? event.usage : event.metrics) as Record<string, unknown> | undefined;
  const props = (event.properties ?? {}) as Record<string, unknown>;
  const timestamp = jsonl ? event.timestamp : event.created_at;
  if (typeof timestamp !== "string" || timestamp.length === 0) return null;
  const model = jsonl
    ? (typeof usage?.model === "string" && usage.model.length > 0 ? usage.model : typeof usage?.responseModel === "string" && usage.responseModel.length > 0 ? usage.responseModel : "unknown")
    : (typeof props.model === "string" && props.model.length > 0 ? props.model : "unknown");
  const tokens = normalizeCopilotCliUsage(usage ?? {});
  if (isAllZero(tokens)) return null;
  const apiCallId = firstString(usage?.apiCallId, usage?.api_call_id, event.apiCallId, event.api_call_id, props.apiCallId, props.api_call_id);
  return { delta: { source: "copilot-cli", model, timestamp, tokens }, apiCallId };
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

export function normalizeCopilotCliUsage(metrics: Record<string, unknown>): TokenDelta {
  const cached = toNonNegInt(metrics.cacheReadTokens ?? metrics.cache_read_tokens);
  const inputUncached = metrics.inputTokensUncached ?? metrics.input_tokens_uncached;
  const hasUncached = inputUncached !== undefined && inputUncached !== null && Number.isFinite(Number(inputUncached)) && Number(inputUncached) >= 0;
  const inputTotal = metrics.inputTokens ?? metrics.input_tokens;
  return {
    inputTokens: hasUncached ? toNonNegInt(inputUncached) : Math.max(0, toNonNegInt(inputTotal) - cached),
    cachedInputTokens: cached,
    outputTokens: toNonNegInt(metrics.outputTokens ?? metrics.output_tokens),
    reasoningOutputTokens: toNonNegInt(metrics.reasoningTokens ?? metrics.reasoning_tokens),
  };
}

// ---------------------------------------------------------------------------
// EOL detection
// ---------------------------------------------------------------------------

/**
 * Detect the line ending width of a file by scanning its first 4 KB.
 * Returns 2 for CRLF (`\r\n`), 1 for LF (`\n`).
 * Falls back to 1 (LF) if no newline is found in the probe window.
 */
async function detectEolSize(filePath: string): Promise<1 | 2> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, 4096);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0x0a) {
        return i > 0 && buf[i - 1] === 0x0d ? 2 : 1;
      }
    }
    return 1;
  } finally {
    await fh.close();
  }
}

import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { TokenDelta } from "@pew/core";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import type { ParsedDelta } from "./claude.js";

/** Result of parsing a single GitHub Copilot CLI process log file */
export interface CopilotCliFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
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
}): Promise<CopilotCliFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile()) return { deltas, endOffset: startOffset };

  const fileSize = st.size;
  if (startOffset >= fileSize) return { deltas, endOffset: startOffset };

  // Detect line ending width (LF=1, CRLF=2) from the first 4 KB.
  // readline with crlfDelay:Infinity strips both \n and \r\n, but we
  // must account for the actual on-disk bytes to keep offset tracking
  // accurate. Windows-generated logs use \r\n.
  const eolBytes = await detectEolSize(filePath);

  const stream = createReadStream(filePath, {
    start: startOffset,
    encoding: "utf8",
  });

  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  // Timestamp pattern that starts a new log line
  const LOG_LINE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const TELEMETRY_MARKER = "[Telemetry] cli.telemetry:";

  let collectingJson = false;
  let jsonLines: string[] = [];

  // Track byte position relative to startOffset for safe endOffset.
  // If the file ends mid-JSON-block, we rewind to the last fully
  // parsed position so the incomplete block gets re-parsed next sync.
  let bytesConsumed = 0;
  let lastCompletedOffset = startOffset;

  /**
   * Try to parse the accumulated JSON lines.
   * Returns true if parse succeeded (or lines were empty), false if
   * the buffer looks incomplete (JSON.parse threw SyntaxError).
   */
  function tryFlushJson(): boolean {
    if (jsonLines.length === 0) return true;
    const raw = jsonLines.join("\n");
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.kind === "assistant_usage") {
        const delta = extractUsageDelta(parsed);
        if (delta) deltas.push(delta);
      }
      jsonLines = [];
      return true;
    } catch {
      // Could be incomplete JSON (still accumulating) or truly malformed
      return false;
    }
  }

  try {
    for await (const line of rl) {
      // Add line content bytes + EOL bytes that readline stripped
      bytesConsumed += Buffer.byteLength(line, "utf8") + eolBytes;

      if (LOG_LINE_RE.test(line)) {
        // New log line — flush any in-progress JSON block first
        if (collectingJson) {
          // Force-flush: a new log line means the JSON block ended (or was malformed).
          // tryFlushJson clears jsonLines on success; on failure the block was
          // malformed and we discard it below.
          tryFlushJson();
          jsonLines = [];
          collectingJson = false;
        }

        if (line.includes(TELEMETRY_MARKER)) {
          collectingJson = true;
          // Do NOT advance lastCompletedOffset past the marker line.
          // If the JSON block that follows is incomplete (file truncated),
          // we need to rewind to BEFORE this marker so the next sync
          // re-reads it and re-enters collectingJson mode.
        } else {
          // Non-telemetry log line — safe to advance past it
          lastCompletedOffset = startOffset + bytesConsumed;
        }
        continue;
      }

      if (collectingJson) {
        jsonLines.push(line);

        // Attempt JSON.parse after each line containing "}" — this is
        // more robust than brace-depth counting which breaks on braces
        // inside JSON string values.
        if (line.includes("}")) {
          const parsed = tryFlushJson();
          if (parsed) {
            collectingJson = false;
            lastCompletedOffset = startOffset + bytesConsumed;
          }
          // If parse failed, keep accumulating — might be nested object
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // Do NOT flush trailing incomplete blocks — leave them for next sync.
  // If the file was fully consumed and no block is pending, endOffset
  // equals fileSize. Otherwise endOffset rewinds to the safe point.
  const endOffset = collectingJson && jsonLines.length > 0
    ? lastCompletedOffset
    : startOffset + bytesConsumed;

  return { deltas, endOffset };
}

/**
 * Extract a ParsedDelta from an `assistant_usage` telemetry event.
 * Returns null if the event has no usable token data or missing timestamp.
 */
function extractUsageDelta(
  event: Record<string, unknown>,
): ParsedDelta | null {
  const props = event.properties as Record<string, unknown> | undefined;
  const metrics = event.metrics as Record<string, unknown> | undefined;

  // Require created_at for idempotent uploads — skip events without it.
  // Using current time as fallback would break reset+sync idempotency.
  const timestamp =
    typeof event.created_at === "string" && event.created_at.length > 0
      ? event.created_at
      : null;
  if (!timestamp) return null;

  const model =
    typeof props?.model === "string" && props.model.length > 0
      ? props.model
      : "unknown";

  const tokens = normalizeCopilotCliUsage(metrics ?? {});
  if (isAllZero(tokens)) return null;

  return { source: "copilot-cli", model, timestamp, tokens };
}

/**
 * Normalize Copilot CLI telemetry metrics to disjoint TokenDelta fields.
 *
 * Prefer `input_tokens_uncached` when present (modern logs). Fall back to
 * max(0, input_tokens - cache_read_tokens) for older telemetry that only
 * reports inclusive input_tokens.
 */
export function normalizeCopilotCliUsage(
  metrics: Record<string, unknown>,
): TokenDelta {
  const cached = toNonNegInt(metrics.cache_read_tokens);
  const inputUncached = metrics.input_tokens_uncached;
  // Prefer explicit uncached field when present and numeric (including 0).
  // Fall back when the key is absent or non-numeric (e.g. string garbage).
  const hasUncached =
    inputUncached !== undefined &&
    inputUncached !== null &&
    Number.isFinite(Number(inputUncached)) &&
    Number(inputUncached) >= 0;

  const inputTokens = hasUncached
    ? toNonNegInt(inputUncached)
    : Math.max(0, toNonNegInt(metrics.input_tokens) - cached);

  return {
    inputTokens,
    cachedInputTokens: cached,
    outputTokens: toNonNegInt(metrics.output_tokens),
    reasoningOutputTokens: 0,
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

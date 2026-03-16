import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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
 * Token fields:
 *   metrics.input_tokens      → inputTokens (total, includes cached)
 *   metrics.cache_read_tokens → cachedInputTokens
 *   metrics.output_tokens     → outputTokens
 */
export async function parseCopilotCliFile(opts: {
  filePath: string;
  startOffset: number;
}): Promise<CopilotCliFileResult> {
  const { filePath, startOffset } = opts;
  const deltas: ParsedDelta[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile()) return { deltas, endOffset: startOffset };

  const endOffset = st.size;
  if (startOffset >= endOffset) return { deltas, endOffset };

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
  let braceDepth = 0;

  function flushJson(): void {
    if (jsonLines.length === 0) return;
    try {
      const raw = jsonLines.join("\n");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.kind === "assistant_usage") {
        const delta = extractUsageDelta(parsed);
        if (delta) deltas.push(delta);
      }
    } catch {
      // Malformed JSON block — skip
    }
    jsonLines = [];
    braceDepth = 0;
  }

  for await (const line of rl) {
    if (LOG_LINE_RE.test(line)) {
      // New log line — flush any in-progress JSON block first
      if (collectingJson) {
        flushJson();
        collectingJson = false;
      }

      if (line.includes(TELEMETRY_MARKER)) {
        collectingJson = true;
        // The JSON starts on the next line
      }
      continue;
    }

    if (collectingJson) {
      jsonLines.push(line);

      // Track brace depth to detect end of top-level JSON object
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }

      if (braceDepth === 0 && jsonLines.length > 0) {
        flushJson();
        collectingJson = false;
      }
    }
  }

  // Flush any trailing block (file ends mid-telemetry)
  if (collectingJson && jsonLines.length > 0) {
    flushJson();
  }

  return { deltas, endOffset };
}

/**
 * Extract a ParsedDelta from an `assistant_usage` telemetry event.
 * Returns null if the event has no usable token data.
 */
function extractUsageDelta(
  event: Record<string, unknown>,
): ParsedDelta | null {
  const props = event.properties as Record<string, unknown> | undefined;
  const metrics = event.metrics as Record<string, unknown> | undefined;

  const model =
    typeof props?.model === "string" && props.model.length > 0
      ? props.model
      : "unknown";

  // Prefer created_at from the event; fall back to current time
  const timestamp =
    typeof event.created_at === "string" && event.created_at.length > 0
      ? event.created_at
      : new Date().toISOString();

  const tokens: TokenDelta = {
    inputTokens: toNonNegInt(metrics?.input_tokens),
    cachedInputTokens: toNonNegInt(metrics?.cache_read_tokens),
    outputTokens: toNonNegInt(metrics?.output_tokens),
    reasoningOutputTokens: 0,
  };

  if (isAllZero(tokens)) return null;

  return { source: "copilot-cli", model, timestamp, tokens };
}

/**
 * VSCode Copilot Chat JSONL parser.
 *
 * Parses CRDT-style append-only operation logs from VSCode Copilot Chat
 * session files. Three operation kinds:
 *
 *   kind=0 (Snapshot)  — full session state, first line of file
 *   kind=1 (Set)       — overwrite value at a JSON path
 *   kind=2 (Append)    — append to array at path
 *
 * Token data lives in kind=1 lines targeting ["requests", N, "result"],
 * specifically in v.metadata.promptTokens / v.metadata.outputTokens.
 *
 * Model ID and timestamp come from the request itself, either in the
 * kind=0 snapshot's requests array or kind=2 appends to ["requests"].
 *
 * The parser maintains a request-index → metadata mapping so that
 * kind=1 result lines (which only carry the index) can be correlated
 * with their model and timestamp. This mapping is persisted in the
 * cursor for incremental sync.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-request metadata extracted from kind=0/2 lines */
export interface RequestMeta {
  modelId: string;
  timestamp: number;
}

/** Info passed to onSkip callback when a request is skipped */
export interface SkipInfo {
  index: number;
  reason: string;
  modelState?: number;
}

/** Options for parsing a VSCode Copilot JSONL file */
export interface VscodeCopilotParseOpts {
  filePath: string;
  startOffset: number;
  /** Persisted index→metadata mapping from prior parse (for incremental resume) */
  requestMeta: Record<number, RequestMeta>;
  /** Indices already emitted as records (skip on re-encounter) */
  processedRequestIndices: number[];
  /** Optional callback invoked for each skipped request (debug auditing) */
  onSkip?: (info: SkipInfo) => void;
}

/** Result of parsing a single VSCode Copilot JSONL file */
export interface VscodeCopilotFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
  /** Updated index→metadata mapping (superset of input requestMeta) */
  requestMeta: Record<number, RequestMeta>;
  /** Updated processed indices (superset of input processedRequestIndices) */
  processedRequestIndices: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip "copilot/" prefix from model IDs (e.g. "copilot/claude-opus-4.6" → "claude-opus-4.6") */
function normalizeModelId(raw: string): string {
  return raw.startsWith("copilot/") ? raw.slice(8) : raw;
}

/** Coerce to non-negative integer, returning 0 for invalid values */
function toNonNegInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Extract modelId and timestamp from a request object */
function extractRequestMeta(req: Record<string, unknown>): RequestMeta | null {
  const rawModelId = req.modelId;
  const rawTimestamp = req.timestamp;

  if (typeof rawModelId !== "string" || !rawModelId) return null;
  if (typeof rawTimestamp !== "number" || !Number.isFinite(rawTimestamp)) return null;

  return {
    modelId: normalizeModelId(rawModelId),
    timestamp: rawTimestamp,
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a VSCode Copilot Chat JSONL file incrementally from a byte offset.
 *
 * Strategy:
 * 1. Build/extend index→metadata mapping from kind=0 snapshot + kind=2 request appends
 * 2. Extract tokens from kind=1 result lines, correlate with metadata via index
 * 3. Skip requests without exact promptTokens/outputTokens
 * 4. Skip already-processed request indices
 */
export async function parseVscodeCopilotFile(
  opts: VscodeCopilotParseOpts,
): Promise<VscodeCopilotFileResult> {
  const { filePath, startOffset, requestMeta: inputMeta, processedRequestIndices: inputProcessed, onSkip } = opts;
  const deltas: ParsedDelta[] = [];

  // Clone mutable state from inputs
  const requestMeta: Record<number, RequestMeta> = { ...inputMeta };
  const processedSet = new Set<number>(inputProcessed);

  // Track the next request index for kind=2 appends
  // Initialize from the highest known index + 1
  let nextRequestIndex = 0;
  for (const key of Object.keys(requestMeta)) {
    const idx = Number(key);
    if (idx >= nextRequestIndex) nextRequestIndex = idx + 1;
  }

  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile()) {
    return {
      deltas,
      endOffset: startOffset,
      requestMeta,
      processedRequestIndices: [...processedSet],
    };
  }

  const endOffset = st.size;
  if (startOffset >= endOffset) {
    return {
      deltas,
      endOffset,
      requestMeta,
      processedRequestIndices: [...processedSet],
    };
  }

  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: startOffset,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  // Deferred result lines: kind=1 results that arrive before their
  // corresponding kind=0/2 metadata (unusual but possible within
  // the same read window)
  const deferredResults: Array<{ index: number; v: Record<string, unknown> }> = [];

  try {
    for await (const line of rl) {
      if (!line) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const kind = obj.kind;

      // ---- kind=0: Snapshot ----
      if (kind === 0) {
        const v = obj.v as Record<string, unknown> | undefined;
        const requests = v?.requests;
        if (Array.isArray(requests)) {
          for (let i = 0; i < requests.length; i++) {
            const req = requests[i] as Record<string, unknown> | undefined;
            if (!req || typeof req !== "object") continue;
            const meta = extractRequestMeta(req);
            if (meta) {
              requestMeta[i] = meta;
              if (i >= nextRequestIndex) nextRequestIndex = i + 1;
            }
          }
        }
        continue;
      }

      // ---- kind=2: Append ----
      if (kind === 2) {
        const k = obj.k;
        // Only care about appends to ["requests"] (top-level request array)
        if (!Array.isArray(k) || k.length !== 1 || k[0] !== "requests") continue;

        const v = obj.v;
        if (!Array.isArray(v)) continue;

        for (const req of v) {
          if (!req || typeof req !== "object") continue;
          const meta = extractRequestMeta(req as Record<string, unknown>);
          if (meta) {
            requestMeta[nextRequestIndex] = meta;
          }
          nextRequestIndex++;
        }
        continue;
      }

      // ---- kind=1: Set ----
      if (kind === 1) {
        const k = obj.k;
        // Only care about ["requests", N, "result"]
        if (!Array.isArray(k) || k.length !== 3) continue;
        if (k[0] !== "requests" || k[2] !== "result") continue;

        const index = typeof k[1] === "number" ? k[1] : Number(k[1]);
        if (!Number.isFinite(index) || index < 0) continue;

        const v = obj.v as Record<string, unknown> | undefined;
        if (!v || typeof v !== "object") continue;

        // Check if already processed
        if (processedSet.has(index)) continue;

        // Try to resolve metadata now
        const meta = requestMeta[index];
        if (!meta) {
          // Defer: metadata might appear later in the same read window
          deferredResults.push({ index, v });
          continue;
        }

        // Mark as processed regardless of whether we emit a delta
        processedSet.add(index);

        // Extract tokens from result.metadata
        const metadata = v.metadata as Record<string, unknown> | undefined;
        if (!metadata || typeof metadata !== "object") {
          onSkip?.({ index, reason: "missing metadata object in result" });
          continue;
        }

        const promptTokens = toNonNegInt(metadata.promptTokens);
        const outputTokens = toNonNegInt(metadata.outputTokens);

        // Skip zero-token results
        if (promptTokens === 0 && outputTokens === 0) {
          const modelState = typeof metadata.modelState === "number" ? metadata.modelState : undefined;
          onSkip?.({ index, reason: "zero tokens (promptTokens=0, outputTokens=0)", modelState });
          continue;
        }

        deltas.push({
          source: "vscode-copilot" as Source,
          model: meta.modelId,
          timestamp: new Date(meta.timestamp).toISOString(),
          tokens: {
            inputTokens: promptTokens,
            outputTokens,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0,
          },
        });
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  // Process deferred results (metadata appeared after the result line)
  for (const { index, v } of deferredResults) {
    if (processedSet.has(index)) continue;

    const meta = requestMeta[index];
    if (!meta) {
      // Still no metadata — skip this result entirely
      processedSet.add(index);
      onSkip?.({ index, reason: "no request metadata found (deferred)" });
      continue;
    }

    processedSet.add(index);

    const metadata = v.metadata as Record<string, unknown> | undefined;
    if (!metadata || typeof metadata !== "object") {
      onSkip?.({ index, reason: "missing metadata object in result (deferred)" });
      continue;
    }

    const promptTokens = toNonNegInt(metadata.promptTokens);
    const outputTokens = toNonNegInt(metadata.outputTokens);

    if (promptTokens === 0 && outputTokens === 0) {
      const modelState = typeof metadata.modelState === "number" ? metadata.modelState : undefined;
      onSkip?.({ index, reason: "zero tokens (deferred)", modelState });
      continue;
    }

    deltas.push({
      source: "vscode-copilot" as Source,
      model: meta.modelId,
      timestamp: new Date(meta.timestamp).toISOString(),
      tokens: {
        inputTokens: promptTokens,
        outputTokens,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
      },
    });
  }

  return {
    deltas,
    endOffset,
    requestMeta,
    processedRequestIndices: [...processedSet],
  };
}

/**
 * VSCode Copilot Chat v3 JSON parser.
 *
 * Parses the newer JSON session format introduced in VS Code 1.108+.
 * Unlike the CRDT JSONL format, v3 files are plain JSON with a
 * `"version": 3` field and a top-level `requests` array.
 *
 * Each request contains model/timestamp metadata alongside result
 * metadata (promptTokens, outputTokens, toolCallRounds).
 *
 * Since v3 files are not append-only, they are fully parsed each time
 * (no incremental byte-offset tracking).
 */

import { readFile } from "node:fs/promises";
import type { Source } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { normalizeModelId, estimateToolRoundTokens } from "./vscode-copilot.js";
import { toNonNegInt } from "../utils/token-delta.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VscodeCopilotV3ParseOpts {
  filePath: string;
  /** Request IDs already processed (for incremental sync dedup) */
  processedRequestIds?: Set<string>;
}

export interface VscodeCopilotV3FileResult {
  deltas: ParsedDelta[];
  /** All request IDs seen (for cursor persistence) */
  processedRequestIds: string[];
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a VSCode Copilot Chat v3 JSON file.
 *
 * Strategy:
 * 1. Read and parse the entire JSON file
 * 2. Validate version field (must be 3)
 * 3. Iterate requests array, extract tokens from each request's result.metadata
 * 4. Skip requests without token data or with zero tokens
 */
export async function parseVscodeCopilotV3File(
  opts: VscodeCopilotV3ParseOpts,
): Promise<VscodeCopilotV3FileResult> {
  const { filePath, processedRequestIds = new Set<string>() } = opts;
  const deltas: ParsedDelta[] = [];
  const allRequestIds: string[] = [];

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { deltas, processedRequestIds: [] };
  }

  let session: Record<string, unknown>;
  try {
    session = JSON.parse(raw);
  } catch {
    return { deltas, processedRequestIds: [] };
  }

  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return { deltas, processedRequestIds: [] };
  }

  // Only handle version 3
  if (session.version !== 3) {
    return { deltas, processedRequestIds: [] };
  }

  const requests = session.requests;
  if (!Array.isArray(requests)) {
    return { deltas, processedRequestIds: [] };
  }

  for (const req of requests) {
    if (!req || typeof req !== "object") continue;
    const r = req as Record<string, unknown>;

    // Extract requestId for dedup tracking
    const requestId = r.requestId;
    if (typeof requestId !== "string" || !requestId) continue;

    // Skip already-processed requests (incremental sync)
    if (processedRequestIds.has(requestId)) {
      // Already processed AND emitted — keep in the list
      allRequestIds.push(requestId);
      continue;
    }

    // Extract model and timestamp
    const rawModelId = r.modelId;
    const rawTimestamp = r.timestamp;

    if (typeof rawModelId !== "string" || !rawModelId) continue;
    if (typeof rawTimestamp !== "number" || !Number.isFinite(rawTimestamp)) continue;

    const modelId = normalizeModelId(rawModelId);
    const timestamp = new Date(rawTimestamp).toISOString();

    // Extract result metadata
    const result = r.result as Record<string, unknown> | undefined;
    if (!result || typeof result !== "object") continue;

    const metadata = result.metadata as Record<string, unknown> | undefined;
    if (!metadata || typeof metadata !== "object") continue;

    const promptTokens = toNonNegInt(metadata.promptTokens);
    const outputTokens = toNonNegInt(metadata.outputTokens);
    const toolCallRounds = Array.isArray(metadata.toolCallRounds) ? metadata.toolCallRounds : [];
    const { toolArgsTokens, thinkingTokens } = estimateToolRoundTokens(toolCallRounds);

    // Skip zero-token results (incomplete request, will retry next sync)
    if (promptTokens === 0 && outputTokens === 0 && toolArgsTokens === 0 && thinkingTokens === 0) {
      continue;
    }

    // Successfully extracted tokens — record this request as processed
    allRequestIds.push(requestId);

    deltas.push({
      source: "vscode-copilot" as Source,
      model: modelId,
      timestamp,
      tokens: {
        inputTokens: promptTokens,
        outputTokens: outputTokens + toolArgsTokens,
        cachedInputTokens: 0,
        reasoningOutputTokens: thinkingTokens,
      },
    });
  }

  return { deltas, processedRequestIds: allRequestIds };
}

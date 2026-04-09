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
}

export interface VscodeCopilotV3FileResult {
  deltas: ParsedDelta[];
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
  const { filePath } = opts;
  const deltas: ParsedDelta[] = [];

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { deltas };
  }

  let session: Record<string, unknown>;
  try {
    session = JSON.parse(raw);
  } catch {
    return { deltas };
  }

  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return { deltas };
  }

  // Only handle version 3
  if (session.version !== 3) {
    return { deltas };
  }

  const requests = session.requests;
  if (!Array.isArray(requests)) {
    return { deltas };
  }

  for (const req of requests) {
    if (!req || typeof req !== "object") continue;
    const r = req as Record<string, unknown>;

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

    // Skip zero-token results
    if (promptTokens === 0 && outputTokens === 0 && toolArgsTokens === 0 && thinkingTokens === 0) {
      continue;
    }

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

  return { deltas };
}

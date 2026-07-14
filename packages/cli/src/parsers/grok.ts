/**
 * Grok CLI unified.jsonl token parser.
 *
 * True source: ~/.grok/logs/unified.jsonl events with
 * msg === "shell.turn.inference_done".
 *
 * xAI field nesting (verified against real logs):
 *   - prompt_tokens includes cached_prompt_tokens
 *   - completion_tokens includes reasoning_tokens
 * Store all four fields as disjoint for SUM total_tokens / estimateCost.
 */

import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

/** Result of parsing the Grok unified log */
export interface GrokFileResult {
  deltas: ParsedDelta[];
  endOffset: number;
}

export type GrokTurnTimeline = Array<{ ts: string; modelId: string }>;

/**
 * Normalize Grok inference_done ctx to TokenDelta.
 *
 * Disjoint convention (same as Claude/Codex after normalize):
 *   inputTokens           = max(0, prompt - cached)
 *   cachedInputTokens     = cached
 *   outputTokens          = max(0, completion - reasoning)
 *   reasoningOutputTokens = reasoning
 */
export function normalizeGrokUsage(ctx: Record<string, unknown>): TokenDelta {
  const prompt = toNonNegInt(ctx.prompt_tokens);
  const cached = toNonNegInt(ctx.cached_prompt_tokens);
  const completion = toNonNegInt(ctx.completion_tokens);
  const reasoning = toNonNegInt(ctx.reasoning_tokens);
  return {
    inputTokens: Math.max(0, prompt - cached),
    cachedInputTokens: cached,
    outputTokens: Math.max(0, completion - reasoning),
    reasoningOutputTokens: reasoning,
  };
}

/**
 * Pick model for an inference event: last turn_started with ts ≤ event.ts.
 */
export function pickModelFromTimeline(
  timeline: GrokTurnTimeline | undefined,
  eventTs: string,
): string | null {
  if (!timeline || timeline.length === 0) return null;
  let chosen: string | null = null;
  for (const entry of timeline) {
    if (entry.ts <= eventTs) {
      chosen = entry.modelId;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Resolve model for one inference_done event.
 */
export function resolveGrokModel(opts: {
  sid: string;
  eventTs: string;
  sidTurnTimeline: Map<string, GrokTurnTimeline>;
  sidPrimaryModel: Map<string, string>;
}): string {
  const timeline = opts.sidTurnTimeline.get(opts.sid);
  const fromTimeline = pickModelFromTimeline(timeline, opts.eventTs);
  if (fromTimeline) return fromTimeline;
  const primary = opts.sidPrimaryModel.get(opts.sid);
  if (primary) return primary;
  return "grok-unknown";
}

/**
 * Parse Grok unified.jsonl incrementally from a byte offset.
 *
 * Streamed by chunk (never loads the whole unread tail into one buffer).
 * Partial-line safe: endOffset stops after the last complete `\n`. A trailing
 * unterminated line is left unread for the next sync.
 */
export async function parseGrokLogFile(opts: {
  filePath: string;
  startOffset: number;
  sidTurnTimeline?: Map<string, GrokTurnTimeline>;
  sidPrimaryModel?: Map<string, string>;
}): Promise<GrokFileResult> {
  const {
    filePath,
    startOffset,
    sidTurnTimeline = new Map(),
    sidPrimaryModel = new Map(),
  } = opts;
  const deltas: ParsedDelta[] = [];

  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile()) return { deltas, endOffset: startOffset };
  if (startOffset >= st.size) return { deltas, endOffset: startOffset };

  const stream = createReadStream(filePath, { start: startOffset });
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
        const lineBytes = nl - offset + 1; // include \n
        completeBytes += lineBytes;
        offset = nl + 1;

        if (lineBuf.length === 0) continue;
        const line = Buffer.from(lineBuf).toString("utf8");

        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Malformed but terminated line — skip and advance past it
          continue;
        }

        if (obj.msg !== "shell.turn.inference_done") continue;

        const ts = typeof obj.ts === "string" ? obj.ts : null;
        if (!ts) continue;

        const sid = typeof obj.sid === "string" ? obj.sid : "";
        const ctx =
          obj.ctx && typeof obj.ctx === "object"
            ? (obj.ctx as Record<string, unknown>)
            : null;
        if (!ctx) continue;

        // Require at least one token field present (missing both → skip)
        if (
          ctx.prompt_tokens === undefined &&
          ctx.completion_tokens === undefined
        ) {
          continue;
        }

        const tokens = normalizeGrokUsage(ctx);
        if (isAllZero(tokens)) continue;

        const model = resolveGrokModel({
          sid,
          eventTs: ts,
          sidTurnTimeline,
          sidPrimaryModel,
        });

        deltas.push({
          source: "grok" as Source,
          model,
          timestamp: ts,
          tokens,
        });
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

// ---------------------------------------------------------------------------
// Model map builders (used by the token driver)
// ---------------------------------------------------------------------------

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Parse events.jsonl for turn_started entries → ordered timeline.
 */
export async function parseGrokTurnTimeline(
  eventsPath: string,
): Promise<GrokTurnTimeline> {
  let raw: string;
  try {
    raw = await readFile(eventsPath, "utf8");
  } catch {
    return [];
  }
  const timeline: GrokTurnTimeline = [];
  for (const line of raw.split("\n")) {
    if (!line?.includes("turn_started")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.type !== "turn_started") continue;
    const ts = typeof obj.ts === "string" ? obj.ts : null;
    const modelId = typeof obj.model_id === "string" ? obj.model_id.trim() : null;
    if (!ts || !modelId) continue;
    timeline.push({ ts, modelId });
  }
  // Ensure chronological order
  timeline.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return timeline;
}

/**
 * Build sid → model maps from ~/.grok/sessions.
 *
 * Fast path: signals.json.modelsUsed.length === 1 → no events scan.
 * Slow path: otherwise scan events.jsonl turn_started timeline.
 */
export async function buildGrokModelMaps(
  sessionsDir: string,
): Promise<{
  sidTurnTimeline: Map<string, GrokTurnTimeline>;
  sidPrimaryModel: Map<string, string>;
}> {
  const sidTurnTimeline = new Map<string, GrokTurnTimeline>();
  const sidPrimaryModel = new Map<string, string>();

  let cwdEntries: string[];
  try {
    cwdEntries = await readdir(sessionsDir);
  } catch {
    return { sidTurnTimeline, sidPrimaryModel };
  }

  for (const cwdEnc of cwdEntries) {
    const cwdPath = join(sessionsDir, cwdEnc);
    let sidEntries: string[];
    try {
      const st = await stat(cwdPath);
      if (!st.isDirectory()) continue;
      sidEntries = await readdir(cwdPath);
    } catch {
      continue;
    }

    for (const sid of sidEntries) {
      const sessionDir = join(cwdPath, sid);
      try {
        const st = await stat(sessionDir);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }

      const signals = await readJsonFile(join(sessionDir, "signals.json"));
      const modelsUsed = signals?.modelsUsed;
      const primary =
        typeof signals?.primaryModelId === "string"
          ? signals.primaryModelId.trim()
          : null;
      if (primary) sidPrimaryModel.set(sid, primary);

      const isFastPath =
        Array.isArray(modelsUsed) &&
        modelsUsed.length === 1 &&
        typeof modelsUsed[0] === "string" &&
        (modelsUsed[0] as string).trim().length > 0;

      if (isFastPath) {
        // Fast path: single model for all inference_done of this sid
        const modelId = (modelsUsed[0] as string).trim();
        sidPrimaryModel.set(sid, modelId);
        // Empty timeline → resolveGrokModel falls through to primary
        continue;
      }

      // Slow path: scan events.jsonl
      const timeline = await parseGrokTurnTimeline(join(sessionDir, "events.jsonl"));
      if (timeline.length > 0) {
        sidTurnTimeline.set(sid, timeline);
      }
    }
  }

  return { sidTurnTimeline, sidPrimaryModel };
}

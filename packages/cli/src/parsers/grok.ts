/**
 * Grok CLI unified.jsonl token parser.
 *
 * True source: ~/.grok/logs/unified.jsonl events with
 * msg === "shell.turn.inference_done". Prompt tokens from xAI include the
 * cached portion, so we store disjoint input/cached like every other source.
 */

import { open, readFile, readdir, stat } from "node:fs/promises";
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
 * prompt_tokens includes cached_prompt_tokens, so non-cached input is
 * max(0, prompt - cached). Fields are disjoint for aggregate/cost math.
 */
export function normalizeGrokUsage(ctx: Record<string, unknown>): TokenDelta {
  const prompt = toNonNegInt(ctx.prompt_tokens);
  const cached = toNonNegInt(ctx.cached_prompt_tokens);
  return {
    inputTokens: Math.max(0, prompt - cached),
    cachedInputTokens: cached,
    outputTokens: toNonNegInt(ctx.completion_tokens),
    reasoningOutputTokens: toNonNegInt(ctx.reasoning_tokens),
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
  if (!st || !st.isFile()) return { deltas, endOffset: startOffset };
  if (startOffset >= st.size) return { deltas, endOffset: startOffset };

  const length = st.size - startOffset;
  const fh = await open(filePath, "r");
  let buf: Buffer;
  try {
    buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, startOffset);
    if (bytesRead < length) {
      buf = buf.subarray(0, bytesRead);
    }
  } finally {
    await fh.close();
  }

  // Only consume complete lines (ending in \n)
  let end = buf.length;
  if (end > 0 && buf[end - 1] !== 0x0a) {
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) {
      // No complete line in this range — leave cursor where it was
      return { deltas, endOffset: startOffset };
    }
    end = lastNl + 1;
  }

  const text = buf.subarray(0, end).toString("utf8");
  // split leaves a trailing empty string when text ends with \n
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line) continue;

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
    if (ctx.prompt_tokens === undefined && ctx.completion_tokens === undefined) {
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

  return { deltas, endOffset: startOffset + end };
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
    if (!line || !line.includes("turn_started")) continue;
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

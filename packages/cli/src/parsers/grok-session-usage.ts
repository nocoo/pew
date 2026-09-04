import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { QueueRecord, Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { normalizeGrokUsage } from "./grok.js";
import { addTokens, emptyTokenDelta, toUtcHalfHourStart } from "../utils/buckets.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";

const GROK_SOURCE: Source = "grok";

export interface SessionUsageSnapshot {
  inputTokens: number;
  cachedReadTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  numTurns: number;
  modelCalls: number;
}

export interface SessionUsageEvent {
  timestampMs: number;
  model: string;
  snapshot: SessionUsageSnapshot;
}

export function isNewUsageEpoch(
  prev: SessionUsageSnapshot | null,
  cur: SessionUsageSnapshot,
): boolean {
  if (prev === null) return true;
  return (
    cur.numTurns < prev.numTurns ||
    cur.inputTokens < prev.inputTokens ||
    cur.modelCalls < prev.modelCalls
  );
}

export function toSessionUsageDelta(
  prev: SessionUsageSnapshot | null,
  cur: SessionUsageSnapshot,
): TokenDelta {
  const raw =
    prev === null || isNewUsageEpoch(prev, cur)
      ? cur
      : {
          inputTokens: Math.max(0, cur.inputTokens - prev.inputTokens),
          cachedReadTokens: Math.max(
            0,
            cur.cachedReadTokens - prev.cachedReadTokens,
          ),
          outputTokens: Math.max(0, cur.outputTokens - prev.outputTokens),
          reasoningTokens: Math.max(
            0,
            cur.reasoningTokens - prev.reasoningTokens,
          ),
          numTurns: cur.numTurns,
          modelCalls: cur.modelCalls,
        };
  return normalizeGrokUsage({
    prompt_tokens: raw.inputTokens,
    cached_prompt_tokens: raw.cachedReadTokens,
    completion_tokens: raw.outputTokens,
    reasoning_tokens: raw.reasoningTokens,
  });
}

function readSnapshot(usage: Record<string, unknown>): SessionUsageSnapshot {
  return {
    inputTokens: toNonNegInt(usage.inputTokens),
    cachedReadTokens: toNonNegInt(usage.cachedReadTokens),
    outputTokens: toNonNegInt(usage.outputTokens),
    reasoningTokens: toNonNegInt(usage.reasoningTokens),
    numTurns: toNonNegInt(usage.numTurns),
    modelCalls: toNonNegInt(usage.modelCalls),
  };
}

function readModel(usage: Record<string, unknown>): string {
  const mu = usage.modelUsage;
  if (mu !== null && typeof mu === "object" && !Array.isArray(mu)) {
    const keys = Object.keys(mu as Record<string, unknown>);
    if (keys[0]) return keys[0];
  }
  return "grok-unknown";
}

function readTimestampMs(
  obj: Record<string, unknown>,
  params: Record<string, unknown>,
): number | null {
  const meta = params._meta;
  if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) {
    const ms = (meta as Record<string, unknown>).agentTimestampMs;
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
      return ms;
    }
  }
  const ts = obj.timestamp;
  if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
    return ts < 1e12 ? ts * 1000 : ts;
  }
  return null;
}

export function parseTurnCompletedLine(line: string): SessionUsageEvent | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const params = rec.params;
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const paramsObj = params as Record<string, unknown>;
  const update = paramsObj.update;
  if (update === null || typeof update !== "object" || Array.isArray(update)) {
    return null;
  }
  const updateObj = update as Record<string, unknown>;
  if (updateObj.sessionUpdate !== "turn_completed") return null;
  const usage = updateObj.usage;
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }
  const timestampMs = readTimestampMs(rec, paramsObj);
  if (timestampMs === null) return null;
  const usageObj = usage as Record<string, unknown>;
  return {
    timestampMs,
    model: readModel(usageObj),
    snapshot: readSnapshot(usageObj),
  };
}

export function accumulateSessionUsage(
  events: SessionUsageEvent[],
): ParsedDelta[] {
  const deltas: ParsedDelta[] = [];
  let prev: SessionUsageSnapshot | null = null;
  for (const event of events) {
    const tokens = toSessionUsageDelta(prev, event.snapshot);
    prev = event.snapshot;
    if (isAllZero(tokens)) continue;
    deltas.push({
      source: GROK_SOURCE,
      model: event.model,
      timestamp: new Date(event.timestampMs).toISOString(),
      tokens,
    });
  }
  return deltas;
}

export async function parseGrokSessionUsageFile(
  filePath: string,
): Promise<ParsedDelta[]> {
  const events: SessionUsageEvent[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.includes("turn_completed")) continue;
    const parsed = parseTurnCompletedLine(line);
    if (parsed) events.push(parsed);
  }
  return accumulateSessionUsage(events);
}

export function occupiedBucketKey(model: string, hourStart: string): string {
  return `${model}|${hourStart}`;
}

export function sessionUsageToIngestRecords(
  deltas: ParsedDelta[],
  opts: { deviceId: string },
): QueueRecord[] {
  const map = new Map<string, QueueRecord>();
  for (const delta of deltas) {
    const hourStart = toUtcHalfHourStart(delta.timestamp);
    if (!hourStart) continue;
    const key = `${delta.model}|${hourStart}`;
    const existing = map.get(key);
    if (existing) {
      existing.input_tokens += delta.tokens.inputTokens;
      existing.cached_input_tokens += delta.tokens.cachedInputTokens;
      existing.output_tokens += delta.tokens.outputTokens;
      existing.reasoning_output_tokens += delta.tokens.reasoningOutputTokens;
      existing.total_tokens =
        existing.input_tokens +
        existing.cached_input_tokens +
        existing.output_tokens +
        existing.reasoning_output_tokens;
      continue;
    }
    const tokens = { ...emptyTokenDelta() };
    addTokens(tokens, delta.tokens);
    map.set(key, {
      source: GROK_SOURCE,
      model: delta.model,
      hour_start: hourStart,
      device_id: opts.deviceId,
      input_tokens: tokens.inputTokens,
      cached_input_tokens: tokens.cachedInputTokens,
      output_tokens: tokens.outputTokens,
      reasoning_output_tokens: tokens.reasoningOutputTokens,
      total_tokens:
        tokens.inputTokens +
        tokens.cachedInputTokens +
        tokens.outputTokens +
        tokens.reasoningOutputTokens,
    });
  }
  return [...map.values()];
}

export function excludeOccupiedBuckets(
  records: QueueRecord[],
  occupied: ReadonlySet<string>,
): QueueRecord[] {
  return records.filter(
    (r) => !occupied.has(occupiedBucketKey(r.model, r.hour_start)),
  );
}

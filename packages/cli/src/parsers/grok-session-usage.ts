import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { AccountingGroup, QueueRecord, Source, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import { normalizeGrokUsage } from "./grok.js";
import { addTokens, emptyTokenDelta, toUtcHalfHourStart } from "../utils/buckets.js";
import { isAllZero, toNonNegInt } from "../utils/token-delta.js";
import { inclusiveAccounting, optionalToken, reportedCost } from "../utils/accounting.js";
import { jsonlCompleteBound } from "../utils/jsonl-offset.js";
import { discoverGrokUsageFiles } from "../discovery/sources.js";

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
  eventId: string | null;
  snapshot: SessionUsageSnapshot;
  accounting?: AccountingGroup[];
  costsPartial?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const partialFlag = (usage: Record<string, unknown>) => ["cost_is_partial", "costIsPartial", "usage_is_incomplete", "usageIsIncomplete"].some((key) => usage[key] === true);
const partialUsage = (usage: Record<string, unknown>) => partialFlag(usage) ||
  (isObject(usage.modelUsage) && Object.values(usage.modelUsage).some((raw) => isObject(raw) && partialFlag(raw)));

/** ACP and persisted turn ledgers use inclusive input; headless result fields must not enter here. */
function usageGroups(usage: Record<string, unknown>, legacyModel: string): AccountingGroup[] {
  const partial = partialUsage(usage);
  const make = (raw: Record<string, unknown>, model: string) => {
    const snapshot = readSnapshot(raw);
    const cost = reportedCost(raw.costUsdTicks, 10, "grok-server", "actual", partial ? "partial" : "complete");
    const group = inclusiveAccounting(toSessionUsageDelta(snapshot), { input: raw.inputTokens, read: raw.cachedReadTokens,
      write: raw.cacheCreationTokens, output: raw.outputTokens, reasoning: raw.reasoningTokens }, {
      origin: "grok:turn_usage", model, provider: "xai", aggregate: raw.modelCalls !== 1, rawTotal: raw.totalTokens,
      reportedCosts: cost ? [cost] : [],
    });
    group.request_count = optionalToken(raw.modelCalls);
    return group;
  };
  const overall = make(usage, legacyModel);
  const rawModels = usage.modelUsage;
  const entries = isObject(rawModels) ? Object.entries(rawModels).filter((entry): entry is [string, Record<string, unknown>] => isObject(entry[1])) : [];
  const groups = entries.map(([model, raw]) => make(raw, model));
  if (!groups.length) return [overall];
  const countFields = ["input_total_tokens", "cache_read_input_tokens", "cache_write_input_tokens", "output_total_tokens", "reasoning_output_tokens"] as const;
  const partition = groups.every((g) => g.counts !== null) && overall.counts && countFields.every((key) =>
    overall.counts?.[key] === null ? groups.every((g) => g.counts?.[key] === null) :
      groups.every((g) => g.counts?.[key] !== null) && groups.reduce((n, g) => n + (g.counts?.[key] ?? 0), 0) === overall.counts?.[key]);
  const amount = overall.reported_costs[0];
  const costsPartition = !amount || groups.every((g) => g.reported_costs[0]) &&
    groups.reduce((n, g) => n + BigInt(g.reported_costs[0].units), BigInt(0)) === BigInt(amount.units);
  if (partition && costsPartition) return groups;
  // Keep the complete turn amount once when it cannot be assigned to models.
  // The unresolved actual model prevents a mixed turn being priced as its first model.
  if (entries.length > 1) overall.model = "mixed";
  return [overall];
}

export function toSessionUsageDelta(cur: SessionUsageSnapshot): TokenDelta {
  return normalizeGrokUsage({
    prompt_tokens: cur.inputTokens,
    cached_prompt_tokens: cur.cachedReadTokens,
    completion_tokens: cur.outputTokens,
    reasoning_tokens: cur.reasoningTokens,
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

function readMeta(
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const meta = params._meta;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

function readTimestampMs(
  obj: Record<string, unknown>,
  params: Record<string, unknown>,
): number | null {
  const meta = readMeta(params);
  if (meta) {
    const ms = meta.agentTimestampMs;
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

function readEventId(params: Record<string, unknown>): string | null {
  const meta = readMeta(params);
  if (!meta) return null;
  return typeof meta.eventId === "string" && meta.eventId.length > 0
    ? meta.eventId
    : null;
}

export function parseTurnCompletedLine(line: string, includeAccounting = false): SessionUsageEvent | null {
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
    eventId: readEventId(paramsObj),
    snapshot: readSnapshot(usageObj),
    ...(includeAccounting ? { costsPartial: partialUsage(usageObj) || partialUsage(updateObj), accounting: usageGroups({ ...usageObj,
      cost_is_partial: partialUsage(usageObj) || partialUsage(updateObj),
    }, readModel(usageObj)) } : {}),
  };
}

export function accumulateSessionUsage(
  events: SessionUsageEvent[],
  seenEventIds: Set<string> = new Set(),
): ParsedDelta[] {
  const deltas: ParsedDelta[] = [];
  for (const event of events) {
    if (event.eventId) {
      if (seenEventIds.has(event.eventId)) continue;
      seenEventIds.add(event.eventId);
    }
    const tokens = toSessionUsageDelta(event.snapshot);
    if (isAllZero(tokens)) continue;
    if (event.accounting) {
      for (const accounting of event.accounting) deltas.push({ source: GROK_SOURCE, model: event.model,
        timestamp: new Date(event.timestampMs).toISOString(), tokens: { inputTokens: accounting.basis.input_tokens,
          cachedInputTokens: accounting.basis.cached_input_tokens, outputTokens: accounting.basis.output_tokens,
          reasoningOutputTokens: accounting.basis.reasoning_output_tokens }, accounting });
      continue;
    }
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
  seenEventIds?: Set<string>,
  opts: { includeAccounting?: boolean; endBound?: number; requireEventId?: boolean } = {},
): Promise<ParsedDelta[]> {
  return accumulateSessionUsage(await readGrokSessionEvents(filePath, opts), seenEventIds);
}

async function readGrokSessionEvents(
  filePath: string,
  opts: { includeAccounting?: boolean; endBound?: number; requireEventId?: boolean },
): Promise<SessionUsageEvent[]> {
  const events: SessionUsageEvent[] = [];
  const st = await stat(filePath);
  const end = await jsonlCompleteBound(filePath, 0, st.size, opts.endBound);
  if (end <= 0) return [];
  const stream = createReadStream(filePath, { encoding: "utf8", end: end - 1 });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  try { for await (const line of rl) {
    if (!line.includes("turn_completed")) continue;
    const parsed = parseTurnCompletedLine(line, opts.includeAccounting);
    if (parsed && (!opts.requireEventId || parsed.eventId)) events.push(parsed);
  } } finally { rl.close(); stream.destroy(); }
  if (opts.includeAccounting) await enrichFromUsageFile(join(dirname(filePath), "usage.json"), events);
  return events;
}

/** A usage.json turn may enrich an identified update, but never becomes independent token usage. */
async function enrichFromUsageFile(path: string, events: SessionUsageEvent[]): Promise<void> {
  let data: unknown;
  try { data = JSON.parse(await readFile(path, "utf8")); } catch { return; }
  if (!isObject(data) || !Array.isArray(data.turns)) return;
  const key = (event: SessionUsageEvent) => JSON.stringify([event.timestampMs, event.model, toSessionUsageDelta(event.snapshot)]);
  const turns = new Map<string, AccountingGroup[] | null>();
  for (const raw of data.turns) {
    if (!isObject(raw)) continue;
    const time = typeof raw.endedAt === "string" ? Date.parse(raw.endedAt) : typeof raw.endedAt === "number" ? raw.endedAt : NaN;
    if (!Number.isFinite(time)) continue;
    const model = readModel(raw);
    const id = key({ timestampMs: time, model, eventId: null, snapshot: readSnapshot(raw) });
    turns.set(id, turns.has(id) ? null : usageGroups(raw, model));
  }
  for (const event of events) {
    if (event.accounting?.some((g) => g.reported_costs.length)) continue;
    const candidate = turns.get(key(event));
    if (!candidate?.some((g) => g.reported_costs.length)) continue;
    // The legacy vector already matched; also require the explicitly reported
    // cache split to agree before replacing any details.
    const counts = (groups: AccountingGroup[]) => groups.map((g) => [g.model, g.counts]);
    if (JSON.stringify(counts(candidate)) === JSON.stringify(counts(event.accounting ?? []))) {
      event.accounting = event.costsPartial ? candidate.map((g) => ({ ...g, reported_costs: g.reported_costs.map((c) => ({ ...c, status: "partial" })) })) : candidate;
    }
  }
}

/** Candidates for exact bucket reconciliation; never union these with unified-log usage. */
export async function readGrokAccountingSnapshots(sessionsDir: string): Promise<ParsedDelta[]> {
  const events = new Map<string, SessionUsageEvent | null>();
  const blockedBuckets = new Set<string>();
  const bucket = (event: SessionUsageEvent) => occupiedBucketKey(event.model, toUtcHalfHourStart(new Date(event.timestampMs).toISOString()) ?? "");
  for (const file of await discoverGrokUsageFiles(sessionsDir)) {
    try {
      for (const event of await readGrokSessionEvents(file, { includeAccounting: true, requireEventId: true })) {
        if (!event.eventId) continue;
        const prior = events.get(event.eventId);
        if (prior === undefined) { events.set(event.eventId, event); continue; }
        const identity = (e: SessionUsageEvent) => JSON.stringify([e.timestampMs, e.model, e.snapshot,
          e.accounting?.map(({ reported_costs: _costs, ...group }) => group)]);
        const compatible = prior && identity(prior) === identity(event) && prior.accounting?.every((g, i) =>
          !g.reported_costs.length || !event.accounting?.[i]?.reported_costs.length ||
          JSON.stringify(g.reported_costs) === JSON.stringify(event.accounting[i].reported_costs));
        if (!compatible) {
          blockedBuckets.add(bucket(event));
          if (prior) blockedBuckets.add(bucket(prior));
          events.set(event.eventId, null);
          continue;
        }
        // A copied turn may have gained a matching usage.json amount. Keep it
        // once; conflicting counts or money invalidate the affected bucket.
        prior.costsPartial = Boolean(prior.costsPartial || event.costsPartial);
        prior.accounting = prior.accounting?.map((g, i) => {
          const merged = g.reported_costs.length ? g : event.accounting?.[i] ?? g;
          return prior.costsPartial ? { ...merged, reported_costs: merged.reported_costs.map((cost) => ({ ...cost, status: "partial" as const })) } : merged;
        });
      }
    }
    catch { /* Unreadable history cannot authorize a bucket replacement. */ }
  }
  return accumulateSessionUsage([...events.values()].filter((e): e is SessionUsageEvent => e !== null && !blockedBuckets.has(bucket(e))));
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

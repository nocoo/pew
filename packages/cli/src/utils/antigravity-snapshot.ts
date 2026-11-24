import type { QueueRecord } from "@pew/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedDelta } from "../parsers/claude.js";
import { toUtcHalfHourStart } from "./buckets.js";
import { isRetiredSource } from "./retired-sources.js";

export const tokenRecordKey = (r: QueueRecord): string =>
  `${r.source}|${r.model}|${r.hour_start}|${r.device_id}`;

export async function readAntigravityBaseline(
  stateDir: string,
  includeRetired = false,
): Promise<QueueRecord[]> {
  let raw: string;
  try {
    raw = await readFile(join(stateDir, "queue.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Cannot verify previous usage queue");
  }
  try {
    const rows = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as QueueRecord);
    if (rows.some((r) => !r || typeof r !== "object" || typeof r.source !== "string"))
      throw new Error();
    const retained = rows.filter(
      (r) => r.source === "antigravity" || (includeRetired && isRetiredSource(r.source)),
    );
    for (const r of retained) {
      if (
        typeof r.device_id !== "string" ||
        typeof r.model !== "string" ||
        typeof r.hour_start !== "string" ||
        !Number.isFinite(Date.parse(r.hour_start)) ||
        [
          r.input_tokens,
          r.cached_input_tokens,
          r.output_tokens,
          r.reasoning_output_tokens,
          r.total_tokens,
        ].some((n) => !Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000) ||
        r.total_tokens !==
          r.input_tokens + r.cached_input_tokens + r.output_tokens + r.reasoning_output_tokens
      )
        throw new Error();
    }
    return retained;
  } catch {
    throw new Error("Cannot verify previous usage queue");
  }
}

export function antigravityRecords(deltas: ParsedDelta[], deviceId: string): QueueRecord[] {
  const records = new Map<string, QueueRecord>();
  for (const d of deltas) {
    const hour = toUtcHalfHourStart(d.timestamp);
    if (d.source !== "antigravity" || !hour || d.evidence)
      throw new Error("Invalid Antigravity snapshot");
    const next: QueueRecord = {
      source: d.source,
      device_id: deviceId,
      model: d.model,
      hour_start: hour,
      input_tokens: d.tokens.inputTokens,
      cached_input_tokens: d.tokens.cachedInputTokens,
      output_tokens: d.tokens.outputTokens,
      reasoning_output_tokens: d.tokens.reasoningOutputTokens,
      total_tokens: Object.values(d.tokens).reduce((sum, n) => sum + n, 0),
    };
    const key = tokenRecordKey(next);
    const prior = records.get(key);
    for (const field of [
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "total_tokens",
    ] as const) {
      const raw = next[field];
      next[field] += prior?.[field] ?? 0;
      if (!Number.isSafeInteger(raw) || raw < 0 || next[field] > 1_000_000_000) {
        throw new Error("Antigravity token limit exceeded");
      }
    }
    records.set(key, next);
  }
  return [...records.values()];
}

export function replaceAntigravityPartition(
  previous: QueueRecord[],
  afterOtherSources: QueueRecord[],
  fresh: QueueRecord[] | null,
  deviceId: string,
): { records: QueueRecord[]; tombstones: QueueRecord[]; changedKeys: string[] } {
  const owned = (r: QueueRecord) => r.source === "antigravity" && r.device_id === deviceId;
  const prior = previous.filter(owned);
  const incoming = fresh ?? prior;
  const keys = new Set(incoming.map(tokenRecordKey));
  const tombstones =
    fresh === null
      ? []
      : prior
          .filter((r) => !keys.has(tokenRecordKey(r)))
          .map((r) => ({
            ...r,
            input_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 0,
          }));
  const snapshots = [...incoming, ...tombstones];
  const old = new Map(prior.map((r) => [tokenRecordKey(r), r]));
  const fields = [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ] as const;
  return {
    records: [
      ...afterOtherSources.filter((r) => r.source !== "antigravity"),
      ...previous.filter((r) => r.source === "antigravity" && !owned(r)),
      ...snapshots,
    ],
    tombstones,
    changedKeys:
      fresh === null
        ? []
        : snapshots
            .filter((r) => {
              const p = old.get(tokenRecordKey(r));
              return !p || fields.some((k) => p[k] !== r[k]);
            })
            .map(tokenRecordKey),
  };
}

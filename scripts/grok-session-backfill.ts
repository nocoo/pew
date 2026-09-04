#!/usr/bin/env bun
/**
 * One-off Grok token recovery from session updates.jsonl.
 *
 * Not wired into `pew sync`. Empty D1 hour buckets only — occupied
 * (model, hour_start) keys are never overwritten.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { QueueRecord } from "@pew/core";
import {
  excludeOccupiedBuckets,
  parseGrokSessionUsageFile,
  sessionUsageToIngestRecords,
} from "../packages/cli/src/parsers/grok-session-usage";

const DEFAULT_SESSIONS = join(homedir(), ".grok", "sessions");
const DEFAULT_DEVICE = "b53ddcac-5c55-4f1a-a746-d138dd1a3d16";
const DEFAULT_HOST = "https://pew.md";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function listUpdatesJsonl(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name === "updates.jsonl") out.push(path);
    }
  }
  await walk(root);
  return out;
}

function daySummary(records: QueueRecord[]): Array<{
  day: string;
  buckets: number;
  total_tokens: number;
}> {
  const map = new Map<string, { buckets: number; total_tokens: number }>();
  for (const r of records) {
    const day = r.hour_start.slice(0, 10);
    const cur = map.get(day) ?? { buckets: 0, total_tokens: 0 };
    cur.buckets += 1;
    cur.total_tokens += r.total_tokens;
    map.set(day, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));
}

async function loadOccupied(path: string | undefined): Promise<Set<string>> {
  if (!path) return new Set();
  const raw = await Bun.file(path).json();
  if (!Array.isArray(raw)) {
    throw new Error(`occupied file must be a JSON array: ${path}`);
  }
  return new Set(raw.map((x) => String(x)));
}

async function main(): Promise<void> {
  const sessionsDir = argValue("--sessions") ?? DEFAULT_SESSIONS;
  const deviceId = argValue("--device-id") ?? DEFAULT_DEVICE;
  const occupiedPath = argValue("--occupied");
  const outPath = argValue("--out");
  const apply = hasFlag("--apply");

  const files = await listUpdatesJsonl(sessionsDir);
  const deltas = [];
  for (const file of files) {
    deltas.push(...(await parseGrokSessionUsageFile(file)));
  }
  const all = sessionUsageToIngestRecords(deltas, { deviceId });
  const occupied = await loadOccupied(occupiedPath);
  const records = excludeOccupiedBuckets(all, occupied);

  const report = {
    files: files.length,
    deltas: deltas.length,
    allBuckets: all.length,
    occupiedKeys: occupied.size,
    emptyBuckets: records.length,
    emptyTotalTokens: records.reduce((s, r) => s + r.total_tokens, 0),
    byDay: daySummary(records),
  };
  console.log(JSON.stringify(report, null, 2));

  if (outPath) {
    await Bun.write(outPath, `${JSON.stringify(records)}\n`);
    console.error(`wrote ${records.length} records to ${outPath}`);
  }

  if (!apply) return;

  const token = process.env.PEW_API_TOKEN;
  if (!token) {
    throw new Error("PEW_API_TOKEN is required for --apply");
  }
  const host = argValue("--host") ?? DEFAULT_HOST;
  const version = argValue("--client-version") ?? "2.28.0";
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const resp = await fetch(`${host}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Pew-Client-Version": version,
      },
      body: JSON.stringify(batch),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`ingest ${resp.status}: ${body.slice(0, 500)}`);
    }
    console.error(`uploaded batch ${i / batchSize + 1} (${batch.length})`);
  }
}

await main();

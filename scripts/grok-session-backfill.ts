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

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function insertSql(userId: string, record: QueueRecord): string {
  return `INSERT INTO usage_records
  (user_id, device_id, source, model, hour_start,
   input_tokens, cached_input_tokens, output_tokens,
   reasoning_output_tokens, total_tokens)
VALUES (${sqlString(userId)}, ${sqlString(record.device_id)}, 'grok',
  ${sqlString(record.model)}, ${sqlString(record.hour_start)},
  ${record.input_tokens}, ${record.cached_input_tokens}, ${record.output_tokens},
  ${record.reasoning_output_tokens}, ${record.total_tokens})
ON CONFLICT (user_id, device_id, source, model, hour_start) DO NOTHING;`;
}

async function main(): Promise<void> {
  const sessionsDir = argValue("--sessions") ?? DEFAULT_SESSIONS;
  const deviceId = argValue("--device-id") ?? DEFAULT_DEVICE;
  const occupiedPath = argValue("--occupied");
  const outPath = argValue("--out");
  const apply = hasFlag("--apply");

  const files = await listUpdatesJsonl(sessionsDir);
  const seenEventIds = new Set<string>();
  const deltas = [];
  for (const file of files) {
    deltas.push(...(await parseGrokSessionUsageFile(file, seenEventIds)));
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
  if (!occupiedPath) {
    throw new Error("--apply requires --occupied so existing hours are not sent");
  }
  const userId = argValue("--user-id");
  if (!userId) {
    throw new Error("--apply requires --user-id");
  }
  const wrangler = argValue("--wrangler") ??
    join(import.meta.dir, "../packages/worker/node_modules/.bin/wrangler");
  const cwd = argValue("--worker-dir") ??
    join(import.meta.dir, "../packages/worker");
  const chunkSize = 20;
  for (let i = 0; i < records.length; i += chunkSize) {
    const batch = records.slice(i, i + chunkSize);
    const sql = batch.map((r) => insertSql(userId, r)).join("\n");
    const sqlPath = `/tmp/pew-grok-backfill-${i}.sql`;
    await Bun.write(sqlPath, sql);
    const proc = Bun.spawn(
      [wrangler, "d1", "execute", "pew-db", "--remote", "--file", sqlPath],
      { cwd, stdout: "inherit", stderr: "inherit" },
    );
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`wrangler d1 execute failed at offset ${i} exit ${code}`);
    }
    console.error(`inserted batch ${i / chunkSize + 1} (${batch.length})`);
  }
}

await main();

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AccountingRecord, QueueRecord } from "@pew/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeReset } from "../../commands/reset.js";
import { executeSessionSync } from "../../commands/session-sync.js";
import { executeStatus } from "../../commands/status.js";
import { executeSync } from "../../commands/sync.js";
import { executeUpload } from "../../commands/upload.js";
import { AccountingQueue, accountingKey } from "../../storage/accounting-queue.js";
import { CursorStore } from "../../storage/cursor-store.js";
import { LocalQueue } from "../../storage/local-queue.js";
import { SessionQueue } from "../../storage/session-queue.js";
import { hashProjectRef } from "../../utils/hash-project-ref.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let n = BigInt(value);
  do {
    bytes.push(Number(n & 127n) | (n > 127n ? 128 : 0));
    n >>= 7n;
  } while (n);
  return Buffer.from(bytes);
}

function scalar(field: number, value: number): Buffer {
  return Buffer.concat([varint(field * 8), varint(value)]);
}

function bytes(field: number, value: string | Buffer): Buffer {
  const data = Buffer.from(value);
  return Buffer.concat([varint(field * 8 + 2), varint(data.length), data]);
}

function metadata(
  input: number,
  read: number | null = 0,
  seconds = 1_759_320_060,
  modelEnum = 99,
  turnId?: string,
): Buffer {
  return Buffer.concat([
    bytes(1, scalar(1, seconds)),
    bytes(9, Buffer.concat([
      scalar(1, modelEnum), scalar(2, input), scalar(3, 30), scalar(4, 0),
      ...(read === null ? [] : [scalar(5, read)]), scalar(9, 7), scalar(10, 23),
    ])),
    ...(turnId !== undefined ? [bytes(12, turnId)] : []),
  ]);
}

describe("CLI E2E: real Antigravity SQLite/WAL accounting", () => {
  let dir: string;
  let stateDir: string;
  let antigravityDir: string;
  let path: string;
  let db: InstanceType<typeof DatabaseSync>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-agy-e2e-"));
    stateDir = join(dir, "state");
    antigravityDir = join(dir, "conversations");
    await mkdir(antigravityDir);
    await mkdir(stateDir);
    await writeFile(join(stateDir, "config.json"), JSON.stringify({ token: "synthetic-token" }));
    path = join(antigravityDir, "synthetic-conversation.db");
    db = new DatabaseSync(path);
    db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA wal_autocheckpoint=0;
      CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB, payload BLOB);
      CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
      CREATE TABLE trajectory_metadata_blob (data BLOB);
    `);
    db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?)").run(bytes(7, "file:///synthetic/project"));
    db.prepare("INSERT INTO steps VALUES (?,?,?,?,?)").run(0, 14, 3, bytes(1, scalar(1, 1_759_320_000)), Buffer.from("synthetic-private-body"));
    step(10, 100, 20);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  function step(idx: number, input: number, read: number | null = 0, model = "gemini-3.1-pro", seconds?: number) {
    db.prepare("INSERT OR REPLACE INTO steps VALUES (?,?,?,?,?)").run(idx, 15, 3, metadata(input, read, seconds), Buffer.from("synthetic-private-body"));
    db.prepare("INSERT OR REPLACE INTO gen_metadata VALUES (?,?)").run(idx + 100, Buffer.concat([
      bytes(1, Buffer.concat([bytes(19, model), bytes(4, scalar(2, 999_999))])), bytes(2, varint(idx)),
    ]));
  }

  const sync = () => executeSync({ stateDir, antigravityDirs: [antigravityDir], deviceId: "synthetic-device" });
  const records = async () => (await new LocalQueue(stateDir).readFromOffset(0)).records;
  const details = async () => (await new AccountingQueue(stateDir).readFromOffset(0)).records;
  const tokenKey = (record: QueueRecord) => JSON.stringify([record.device_id, record.source, record.model, record.hour_start]);

  function server() {
    const usage = new Map<string, QueueRecord>();
    const accounting = new Map<string, AccountingRecord>();
    const requests: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const endpoint = String(input);
      requests.push(endpoint);
      const body = String(init?.body);
      expect(body).not.toContain("synthetic-private-body");
      expect(body).not.toContain("file:///synthetic/project");
      if (endpoint.endsWith("/api/ingest/details")) {
        const rows = JSON.parse(body) as AccountingRecord[];
        for (const record of rows) accounting.set(accountingKey(record), record);
        return Response.json({ details_version: 1, acknowledgments: rows.map((record) => ({
          key: accountingKey(record), source_revision: record.source_revision, parser_revision: record.parser_revision,
          detail_revision: record.detail_revision, status: "applied",
        })) });
      }
      expect(endpoint).toBe("https://synthetic.invalid/api/ingest");
      const rows = JSON.parse(body) as QueueRecord[];
      for (const record of rows) usage.set(tokenKey(record), record);
      return Response.json({ ingested: rows.length });
    };
    const upload = () => executeUpload({ stateDir, apiUrl: "https://synthetic.invalid", fetch, maxRetries: 0 });
    return { usage, accounting, requests, upload };
  }

  it("reads the private WAL snapshot with the actual Bun SQLite runtime", async () => {
    const paths = [path, `${path}-wal`, `${path}-shm`];
    const source = await Promise.all(paths.map((file) => readFile(file)));
    const { stdout } = await promisify(execFile)("bun", ["-e", `
      import { readAntigravitySource } from ${JSON.stringify(new URL("../../parsers/antigravity.ts", import.meta.url).pathname)};
      const result = await readAntigravitySource([${JSON.stringify(antigravityDir)}]);
      console.log(JSON.stringify({ tokens: result.deltas[0].tokens, dbCount: result.dbCount }));
    `]);
    expect(JSON.parse(stdout)).toEqual({ dbCount: 1, tokens: {
      inputTokens: 100, cachedInputTokens: 20, outputTokens: 23, reasoningOutputTokens: 7,
    } });
    expect(await Promise.all(paths.map((file) => readFile(file)))).toEqual(source);
  });

  it("roundtrips exact disjoint counters, sessions and status without source mutations or repeated uploads", async () => {
    const source = await Promise.all([path, `${path}-wal`, `${path}-shm`].map((file) => readFile(file)));
    const result = await sync();
    expect(result.sources.antigravity).toBe(1);
    expect(result.dbsScanned.antigravity).toBe(1);
    expect((await records())[0]).toMatchObject({ source: "antigravity", input_tokens: 100, cached_input_tokens: 20,
      output_tokens: 23, reasoning_output_tokens: 7, total_tokens: 150 });
    expect((await details())[0].groups[0].counts).toMatchObject({ input_total_tokens: 120, cache_read_input_tokens: 20,
      output_total_tokens: 30, reasoning_output_tokens: 7 });
    const sessions = await executeSessionSync({ stateDir, antigravityDirs: [antigravityDir] });
    expect(sessions.sources.antigravity).toBe(1);
    expect((await new SessionQueue(stateDir).readFromOffset(0)).records[0]).toMatchObject({
      session_key: "antigravity:synthetic-conversation", source: "antigravity", user_messages: 1, assistant_messages: 1,
      total_messages: 2, project_ref: hashProjectRef("file:///synthetic/project"), duration_seconds: 60,
    });
    expect(await Promise.all([path, `${path}-wal`, `${path}-shm`].map((file) => readFile(file)))).toEqual(source);
    const missing = join(dir, "missing");
    const status = await executeStatus({ stateDir, sourceDirs: {
      claudeDir: missing, codexSessionsDir: missing, openCodeMessageDir: missing, openclawDir: missing,
      piSessionsDir: missing, copilotCliLogsDir: missing, copilotCliOtelPaths: [], multicaCodexDirs: [], grokHome: missing,
    } });
    expect(status).toMatchObject({ trackedFiles: 1, pendingRecords: 1, sources: { antigravity: 1 } });
    const remote = server();
    expect((await remote.upload()).success).toBe(true);
    expect(remote.usage.size).toBe(1);
    expect(remote.accounting.size).toBe(1);
    const count = remote.requests.length;
    await sync();
    expect((await remote.upload()).uploaded).toBe(0);
    expect(remote.requests).toHaveLength(count);
    await rm(join(stateDir, "cursors.json"));
    await sync();
    expect((await records())[0].total_tokens).toBe(150);
    expect((await remote.upload()).uploaded).toBe(0);
  });

  it("replaces WAL-only low-index history and corrections, including known-zero cache and removed-bucket tombstones", async () => {
    const remote = server();
    await sync();
    await remote.upload();
    const main = await readFile(path);
    step(2, 50, null);
    expect(await readFile(path)).toEqual(main);
    await sync();
    expect((await records())[0]).toMatchObject({ input_tokens: 150, cached_input_tokens: 20, total_tokens: 230 });
    expect((await details())[0].groups[0].counts?.cache_read_input_tokens).toBe(20);
    expect((await details())[0].groups[0].counts?.input_total_tokens).toBe(170);
    expect(Number((await details())[0].groups[0].counts?.cache_read_input_tokens) / Number((await details())[0].groups[0].counts?.input_total_tokens)).toBe(20 / 170);
    await remote.upload();
    expect([...remote.usage.values()][0].total_tokens).toBe(230);
    step(10, 10, 0);
    await sync();
    expect((await records())[0].total_tokens).toBe(120);
    expect((await details())[0].groups[0].counts?.cache_read_input_tokens).toBe(0);
    await remote.upload();
    expect([...remote.usage.values()][0].total_tokens).toBe(120);
    step(10, 10, 0, "gemini-3-flash", 1_759_321_860);
    db.exec("DELETE FROM steps WHERE idx = 2; DELETE FROM gen_metadata WHERE idx = 102;");
    await executeReset({ stateDir });
    await sync();
    await remote.upload();
    expect([...remote.usage.values()].find((record) => record.model === "gemini-3.1-pro")?.total_tokens).toBe(0);
    expect([...remote.usage.values()].find((record) => record.model === "gemini-3-flash")?.total_tokens).toBe(40);
    expect([...remote.accounting.values()].find((record) => record.model === "gemini-3.1-pro")?.basis.total_tokens).toBe(0);
    await executeReset({ stateDir });
    await sync();
    await remote.upload();
    expect([...remote.usage.values()].reduce((sum, record) => sum + record.total_tokens, 0)).toBe(40);
    db.exec("DELETE FROM steps WHERE step_type = 15");
    await executeReset({ stateDir });
    await sync();
    await remote.upload();
    expect([...remote.usage.values()].every((record) => record.total_tokens === 0)).toBe(true);
    expect([...remote.accounting.values()].every((record) => record.basis.total_tokens === 0)).toBe(true);
  });

  it("fails source decoding closed without clearing its queue or an independent Claude partition", async () => {
    const claudeDir = join(dir, "claude");
    const project = join(claudeDir, "projects", "synthetic");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "session.jsonl"), `${JSON.stringify({ type: "assistant", timestamp: "2025-10-01T12:01:00Z",
      message: { id: "synthetic-id", model: "claude-sonnet-4", usage: { input_tokens: 40, output_tokens: 10 } } })}\n`);
    const options = { stateDir, antigravityDirs: [antigravityDir], claudeDir, deviceId: "synthetic-device" };
    await executeSync(options);
    const before = await records();
    const accounting = await details();
    db.prepare("UPDATE steps SET metadata = ? WHERE idx = 10").run(Buffer.from([128]));
    const warnings: string[] = [];
    await executeSync({ ...options, onProgress: (event) => { if (event.phase === "warn") warnings.push(event.message ?? ""); } });
    expect(warnings.some((warning) => warning.includes("Antigravity"))).toBe(true);
    expect(await records()).toEqual(before);
    expect(await details()).toEqual(accounting);
    expect(before.find((record) => record.source === "claude-code")?.total_tokens).toBe(50);
    step(10, 100, 20, "gemini-3.1-pro", 1_759_320_000 + 315_576_001);
    await executeSync(options);
    expect(await records()).toEqual(before);
    expect(await details()).toEqual(accounting);
  });

  it("syncs multiple roots with step_type=23 attribution, hits per-DB cache, and refreshes WAL-only DB mutations", async () => {
    const appDir = join(dir, "app-conversations");
    await mkdir(appDir);
    const secondPath = join(appDir, "compaction-conversation.db");
    const secondDb = new DatabaseSync(secondPath);
    try {
      secondDb.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA wal_autocheckpoint=0;
        CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB, payload BLOB);
        CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
        CREATE TABLE trajectory_metadata_blob (data BLOB);
      `);
      secondDb.prepare("INSERT INTO trajectory_metadata_blob VALUES (?)").run(bytes(7, "file:///synthetic/app-project"));
      secondDb.prepare("INSERT INTO steps VALUES (?,?,?,?,?)").run(0, 14, 3, bytes(1, scalar(1, 1_759_320_000)), Buffer.from("synthetic-body"));
      secondDb.prepare("INSERT INTO steps VALUES (?,?,?,?,?)").run(1, 15, 3, metadata(40, 10, 1_759_320_070, 1319, "turn-1"), Buffer.from("synthetic-body"));
      secondDb.prepare("INSERT INTO gen_metadata VALUES (?,?)").run(10, Buffer.concat([
        bytes(1, Buffer.concat([bytes(19, "gemini-3.8-flash-n"), bytes(4, scalar(2, 999_999))])),
        bytes(2, varint(1)),
      ]));
      // step_type=23 compaction step with no gen_metadata row, attributed via (turnId, modelEnum)
      secondDb.prepare("INSERT INTO steps VALUES (?,?,?,?,?)").run(2, 23, 3, metadata(50, 200, 1_759_320_080, 1319, "turn-1"), Buffer.from("synthetic-body"));

      const multiSync = () => executeSync({
        stateDir,
        antigravityDirs: [antigravityDir, appDir],
        deviceId: "synthetic-device",
      });
      const first = await multiSync();
      expect(first.dbsScanned.antigravity).toBe(2);
      expect(first.sources.antigravity).toBe(3);

      const firstRecords = await records();
      expect(firstRecords.find((r) => r.model === "gemini-3.1-pro")?.total_tokens).toBe(150);
      expect(firstRecords.find((r) => r.model === "gemini-3.8-flash-n")).toMatchObject({
        input_tokens: 90,
        cached_input_tokens: 210,
        output_tokens: 46,
        reasoning_output_tokens: 14,
        total_tokens: 360,
      });

      const sessions = await executeSessionSync({ stateDir, antigravityDirs: [antigravityDir, appDir] });
      expect(sessions.sources.antigravity).toBe(2);

      const cursor = (await new CursorStore(stateDir).load()).antigravity;
      expect(cursor).toMatchObject({ dbCount: 2, cacheVersion: 1 });
      expect(Object.keys(cursor?.dbs ?? {}).sort()).toEqual([path, secondPath].sort());

      const remote = server();
      expect((await remote.upload()).success).toBe(true);
      expect(remote.usage.size).toBe(2);

      // Second sync hits per-DB cache with zero uploads
      const second = await multiSync();
      expect(second.sources.antigravity).toBe(3);
      expect(await records()).toEqual(firstRecords);
      expect((await remote.upload()).uploaded).toBe(0);

      // WAL-only mutation on secondDb updates only gemini-3.8-flash-n while leaving synthetic-conversation.db intact
      secondDb.prepare("UPDATE steps SET metadata = ? WHERE idx = 2").run(metadata(150, 200, 1_759_320_080, 1319, "turn-1"));
      const third = await multiSync();
      expect(third.dbsScanned.antigravity).toBe(2);
      const updatedRecords = await records();
      expect(updatedRecords.find((r) => r.model === "gemini-3.1-pro")?.total_tokens).toBe(150);
      expect(updatedRecords.find((r) => r.model === "gemini-3.8-flash-n")?.total_tokens).toBe(460);
      // Uploads 1 updated token bucket + 1 updated accounting detail record for gemini-3.8-flash-n
      expect((await remote.upload()).uploaded).toBe(2);
      expect(remote.usage.get('["synthetic-device","antigravity","gemini-3.8-flash-n","2025-10-01T12:00:00.000Z"]')?.total_tokens).toBe(460);
      expect(remote.usage.get('["synthetic-device","antigravity","gemini-3.1-pro","2025-10-01T12:00:00.000Z"]')?.total_tokens).toBe(150);
    } finally {
      secondDb.close();
    }
  });
});

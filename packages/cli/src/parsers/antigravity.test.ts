import { createHash } from "node:crypto";
import { readdirSync, rmSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planAccountingUpdates } from "../storage/accounting-queue.js";
import { antigravityRecords } from "../utils/antigravity-snapshot.js";
import { hashProjectRef } from "../utils/hash-project-ref.js";
import {
  decodeAntigravityMetadata,
  readAntigravitySource,
  UnstableAntigravityError,
  validateAntigravitySession,
} from "./antigravity.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const dirs: string[] = [];
const writers: Array<{ close(): void }> = [];

function varint(value: number | bigint): Buffer {
  let n = BigInt(value);
  const bytes: number[] = [];
  do {
    bytes.push(Number(n & 127n) | (n > 127n ? 128 : 0));
    n >>= 7n;
  } while (n);
  return Buffer.from(bytes);
}

function scalar(field: number, value: number | bigint): Buffer {
  return Buffer.concat([varint(field * 8), varint(value)]);
}

function bytes(field: number, value: Uint8Array | string): Buffer {
  const data = Buffer.from(value);
  return Buffer.concat([varint(field * 8 + 2), varint(data.length), data]);
}

function usage(fields: Record<number, number | bigint>): Buffer {
  return Buffer.concat(
    Object.entries(fields).map(([field, value]) => scalar(Number(field), value)),
  );
}

function metadata(
  seconds = 1_700_000_000,
  fields?: Record<number, number | bigint>,
  nanos = 123_999_999,
  turnId?: string,
): Buffer {
  return Buffer.concat([
    bytes(1, Buffer.concat([scalar(1, seconds), scalar(2, nanos)])),
    ...(fields ? [bytes(9, usage(fields))] : []),
    ...(turnId !== undefined ? [bytes(12, turnId)] : []),
  ]);
}

function generation(indices: number[], model = "gemini-3.1-pro", packed = true): Buffer {
  const chat = Buffer.concat([bytes(19, model), bytes(4, usage({ 2: 999_999, 3: 999_999 }))]);
  return Buffer.concat([
    bytes(1, chat),
    ...(packed
      ? [bytes(2, Buffer.concat(indices.map(varint)))]
      : indices.map((idx) => scalar(2, idx))),
  ]);
}

async function fixture(wal = false, dbName = "conversation.db") {
  const root = await mkdtemp(join(tmpdir(), "pew-antigravity-test-"));
  dirs.push(root);
  const path = join(root, dbName);
  const db = new DatabaseSync(path);
  writers.push(db);
  if (wal) db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
  db.exec(`
    CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB, payload BLOB);
    CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
    CREATE TABLE trajectory_metadata_blob (data BLOB);
  `);
  db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?)").run(
    bytes(7, "file:///synthetic/project"),
  );
  const step = (idx: number, data: Uint8Array, type = 15, status = 3) =>
    db
      .prepare("INSERT INTO steps VALUES (?,?,?,?,?)")
      .run(idx, type, status, data, Buffer.from("private-payload"));
  const gen = (idx: number, indices: number[], model?: string, packed?: boolean) =>
    db
      .prepare("INSERT INTO gen_metadata VALUES (?,?)")
      .run(idx, generation(indices, model, packed));
  return { root, path, db, step, gen };
}

afterEach(async () => {
  for (const writer of writers.splice(0)) writer.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("Antigravity private SQLite snapshot", () => {
  it("joins generation step_indices, not table idx, and never counts generation totals", async () => {
    const f = await fixture();
    f.step(0, metadata(1_700_000_000), 14);
    f.step(3, metadata(1_700_000_003, { 1: 999, 2: 100, 3: 30, 4: 0, 5: 20, 9: 7, 10: 23 }));
    f.step(4, metadata(1_700_000_004, { 2: 10, 3: 5, 5: 0 }));
    f.step(5, metadata(1_700_000_005, { 2: 50, 3: 10 }), 15, 1);
    f.step(6, metadata(1_700_000_005), 20);
    f.gen(90, [3, 4]);
    f.gen(91, [3], "gemini-3.1-pro", false);
    const result = await readAntigravitySource([f.root]);
    expect(result.dbCount).toBe(1);
    expect(result.stepCount).toBe(2);
    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0]).toMatchObject({
      source: "antigravity",
      model: "gemini-3.1-pro",
      timestamp: "2023-11-14T22:13:23.123Z",
      tokens: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 23,
        reasoningOutputTokens: 7,
      },
      accounting: {
        counts: {
          input_total_tokens: 120,
          cache_read_input_tokens: 20,
          output_total_tokens: 30,
          reasoning_output_tokens: 7,
        },
      },
    });
    expect(result.deltas[1].accounting?.counts?.cache_read_input_tokens).toBe(0);
    expect(result.deltas[1].accounting?.counts?.reasoning_output_tokens).toBe(0);
    expect(result.snapshots).toEqual([
      expect.objectContaining({
        sessionKey: "antigravity:conversation",
        source: "antigravity",
        kind: "human",
        startedAt: "2023-11-14T22:13:20.123Z",
        lastMessageAt: "2023-11-14T22:13:25.123Z",
        durationSeconds: 5,
        userMessages: 1,
        assistantMessages: 3,
        totalMessages: 4,
        projectRef: hashProjectRef("file:///synthetic/project"),
        model: "gemini-3.1-pro",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("private-payload");
    expect(JSON.stringify(result)).not.toContain("file:///synthetic");
    expect((await readAntigravitySource([f.root])).deltas).toEqual(result.deltas);
  });

  it("reads WAL-only changes while leaving the main, WAL and shm byte-identical", async () => {
    const f = await fixture(true);
    f.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    f.gen(40, [1]);
    const paths = [f.path, `${f.path}-wal`, `${f.path}-shm`];
    const before = await Promise.all(paths.map((path) => readFile(path)));
    const result = await readAntigravitySource([f.root]);
    expect(result.deltas[0].tokens.inputTokens).toBe(10);
    expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before);
    const mainHash = createHash("sha256").update(before[0]).digest("hex");
    f.db
      .prepare("UPDATE steps SET metadata = ? WHERE idx = 1")
      .run(metadata(1_700_000_000, { 2: 30, 3: 5 }));
    expect(
      createHash("sha256")
        .update(await readFile(f.path))
        .digest("hex"),
    ).toBe(mainHash);
    expect((await readAntigravitySource([f.root])).deltas[0].tokens.inputTokens).toBe(30);
  });

  it("never opens original files and rejects source mutation during private queries", async () => {
    const f = await fixture();
    f.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    f.gen(0, [1]);
    let privatePath = "";
    await expect(
      readAntigravitySource([f.root], {
        opener: (path) => {
          privatePath = path;
          expect(path).not.toBe(f.path);
          expect(basename(path)).toBe("conversation.db");
          f.db
            .prepare("UPDATE steps SET metadata = ? WHERE idx = 1")
            .run(metadata(1_700_000_000, { 2: 20, 3: 5 }));
          return new DatabaseSync(path, { readOnly: true });
        },
      }),
    ).rejects.toBeInstanceOf(UnstableAntigravityError);
    await expect(readFile(privatePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses private 0600 copies, never copies shm, and removes copies after open failures", async () => {
    const f = await fixture(true);
    let copy = "";
    await expect(
      readAntigravitySource([f.root], {
        opener: (path) => {
          copy = path;
          throw new Error("injected open failure");
        },
      }),
    ).rejects.toThrow("injected open failure");
    await expect(readFile(copy)).rejects.toMatchObject({ code: "ENOENT" });
    await chmod(f.path, 0o644);
    await readAntigravitySource([f.root], {
      opener: (path) => {
        copy = path;
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(statSync(`${path}-wal`).mode & 0o777).toBe(0o600);
        expect(readdirSync(dirname(path))).toEqual(["conversation.db", "conversation.db-wal"]);
        return new DatabaseSync(path, { readOnly: true });
      },
    });
    await expect(readFile(copy)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects database directories and symlinks without opening them", async () => {
    const f = await fixture();
    await mkdir(join(f.root, "bad.db"));
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/regular file/i);
    await rm(join(f.root, "bad.db"), { recursive: true });
    await symlink(f.path, join(f.root, "bad.db"));
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/regular file/i);
  });

  it("distinguishes missing roots from an existing empty root", async () => {
    const f = await fixture();
    await expect(readAntigravitySource([join(f.root, "missing")])).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readAntigravitySource([])).rejects.toMatchObject({ code: "ENOENT" });
    f.db.close();
    writers.splice(writers.indexOf(f.db), 1);
    await rm(f.path);
    await writeFile(join(f.root, "unrelated.txt"), "ignored");
    expect(await readAntigravitySource([f.root])).toEqual({
      deltas: [],
      snapshots: [],
      dbCount: 0,
      stepCount: 0,
      dbs: {},
      warnings: [],
    });
    expect(await readdir(f.root)).toEqual(["unrelated.txt"]);
  });

  it("discovers across multiple roots, rethrows non-ENOENT errors, and rejects duplicate IDs", async () => {
    const cli = await fixture(false, "conv-cli.db");
    const app = await fixture(false, "conv-app.db");
    cli.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    cli.gen(1, [1], "gemini-3.8-flash");
    app.step(1, metadata(1_700_000_010, { 2: 20, 3: 5 }));
    app.gen(1, [1], "gemini-4-neon");

    const combined = await readAntigravitySource([
      join(cli.root, "missing"),
      cli.root,
      app.root,
      cli.root,
    ]);
    expect(combined.dbCount).toBe(2);
    expect(combined.deltas.map((d) => d.model)).toEqual(["gemini-4-neon", "gemini-3.8-flash"]);

    const notADir = join(cli.root, "not-a-dir");
    await writeFile(notADir, "file");
    await expect(readAntigravitySource([notADir])).rejects.toThrow();

    const dup = await fixture(false, "conv-cli.db");
    await expect(readAntigravitySource([cli.root, dup.root])).rejects.toThrow(/duplicate/i);
  });

  it("resolves unattributed step_type=23 usage via unambiguous (turnId, modelEnum) and DB enum fallback", async () => {
    const f = await fixture();
    // Turn A uses enum 1319 as gemini-3.8-flash-n; step 2 is step_type=23 with no gen_metadata
    f.step(1, metadata(1_700_000_000, { 1: 1319, 2: 100, 3: 10 }, 0, "turn-a"), 15);
    f.step(2, metadata(1_700_000_010, { 1: 1319, 2: 200, 3: 20, 5: 500 }, 0, "turn-a"), 23);
    // Turn B uses the same enum 1319 as gemini-3.8-flash; step 4 is step_type=23 with no gen_metadata
    f.step(3, metadata(1_700_000_020, { 1: 1319, 2: 150, 3: 15 }, 0, "turn-b"), 15);
    f.step(4, metadata(1_700_000_030, { 1: 1319, 2: 250, 3: 25, 5: 600 }, 0, "turn-b"), 23);
    // Step 5 uses enum 1526 without turnId; DB-wide enum 1526 uniquely maps to gemini-4-hydrogen
    f.step(5, metadata(1_700_000_040, { 1: 1526, 2: 50, 3: 5 }, 0, "turn-c"), 15);
    f.step(6, metadata(1_700_000_050, { 1: 1526, 2: 60, 3: 6 }), 23);
    f.gen(1, [1], "gemini-3.8-flash-n");
    f.gen(2, [3], "gemini-3.8-flash");
    f.gen(3, [5], "gemini-4-hydrogen");

    const result = await readAntigravitySource([f.root]);
    expect(result.deltas.map((d) => [d.model, d.tokens.inputTokens])).toEqual([
      ["gemini-3.8-flash-n", 100],
      ["gemini-3.8-flash-n", 200],
      ["gemini-3.8-flash", 150],
      ["gemini-3.8-flash", 250],
      ["gemini-4-hydrogen", 50],
      ["gemini-4-hydrogen", 60],
    ]);
    expect(result.snapshots[0]?.model).toBe("gemini-4-hydrogen");
  });

  it("fails closed when step_type=23 model attribution is ambiguous or unmapped", async () => {
    const f = await fixture();
    // Same turn, same enum, two conflicting models in gen_metadata -> ambiguous
    f.step(1, metadata(1_700_000_000, { 1: 1319, 2: 10, 3: 5 }, 0, "turn-a"), 15);
    f.step(2, metadata(1_700_000_010, { 1: 1319, 2: 20, 3: 5 }, 0, "turn-a"), 15);
    f.step(3, metadata(1_700_000_020, { 1: 1319, 2: 30, 3: 5 }, 0, "turn-a"), 23);
    f.gen(1, [1], "gemini-3.8-flash-n");
    f.gen(2, [2], "gemini-3.8-flash");
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/model/i);

    // Zero or absent modelEnum cannot fall back
    const f2 = await fixture();
    f2.step(1, metadata(1_700_000_000, { 1: 1319, 2: 10, 3: 5 }, 0, "turn-a"), 15);
    f2.step(2, metadata(1_700_000_010, { 1: 0, 2: 20, 3: 5 }, 0, "turn-a"), 23);
    f2.gen(1, [1], "gemini-3.8-flash");
    await expect(readAntigravitySource([f2.root])).rejects.toThrow(/model/i);

    // Unmapped enum in a fresh turn when DB has conflicting models for that enum
    const f3 = await fixture();
    f3.step(1, metadata(1_700_000_000, { 1: 1319, 2: 10, 3: 5 }, 0, "turn-a"), 15);
    f3.step(2, metadata(1_700_000_010, { 1: 1319, 2: 20, 3: 5 }, 0, "turn-b"), 15);
    f3.step(3, metadata(1_700_000_020, { 1: 1319, 2: 30, 3: 5 }, 0, "turn-c"), 23);
    f3.gen(1, [1], "gemini-3.8-flash-n");
    f3.gen(2, [2], "gemini-3.8-flash");
    await expect(readAntigravitySource([f3.root])).rejects.toThrow(/model/i);
  });

  it("caches per-DB snapshots across bands and produces bit-identical usage & accounting", async () => {
    const f = await fixture(true);
    // Two steps in same (model, half-hour) across two context bands (<200k and >200k)
    f.step(
      1,
      metadata(1_700_000_000, { 1: 1533, 2: 10_000, 3: 100, 5: 50_000, 9: 40, 10: 60 }),
      15,
    );
    f.step(
      2,
      metadata(1_700_000_120, { 1: 1533, 2: 20_000, 3: 200, 5: 220_000, 9: 80, 10: 120 }),
      15,
    );
    f.step(
      3,
      metadata(1_700_000_240, { 1: 1533, 2: 30_000, 3: 300, 5: 40_000, 9: 50, 10: 250 }),
      15,
    );
    f.gen(1, [1, 2, 3], "gemini-4-neon");

    const cold = await readAntigravitySource([f.root]);
    expect(cold.stepCount).toBe(3);

    const opener = vi.fn((path: string) => new DatabaseSync(path, { readOnly: true }));
    const warm = await readAntigravitySource([f.root], { opener, cache: cold.dbs });
    expect(opener).not.toHaveBeenCalled();
    expect(warm.stepCount).toBe(3);
    expect(warm.dbCount).toBe(1);
    expect(warm.snapshots).toEqual(cold.snapshots);

    const coldRecords = antigravityRecords(cold.deltas, "dev-1");
    const warmRecords = antigravityRecords(warm.deltas, "dev-1");
    expect(warmRecords).toEqual(coldRecords);

    const coldAccounting = planAccountingUpdates({
      previous: [],
      before: [],
      after: coldRecords,
      deltas: cold.deltas,
      replay: true,
      deviceId: "dev-1",
    });
    const warmAccounting = planAccountingUpdates({
      previous: [],
      before: [],
      after: warmRecords,
      deltas: warm.deltas,
      replay: true,
      deviceId: "dev-1",
    });
    expect(warmAccounting).toEqual(coldAccounting);
    expect(warmAccounting[0]?.groups).toHaveLength(2);

    // WAL-only mutation invalidates cache and re-opens the DB
    f.step(4, metadata(1_700_000_300, { 1: 1533, 2: 1_000, 3: 10 }), 15);
    f.gen(2, [4], "gemini-4-neon");
    const refreshed = await readAntigravitySource([f.root], { opener, cache: warm.dbs });
    expect(opener).toHaveBeenCalledTimes(1);
    expect(refreshed.stepCount).toBe(4);
  });

  it("ignores malformed cache entries and re-parses from SQLite", async () => {
    const f = await fixture();
    f.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }), 14);
    f.gen(1, [1], "gemini-3.1-pro");
    const baseline = await readAntigravitySource([f.root]);
    const valid = baseline.dbs[f.path]!;

    const badCaches: unknown[] = [
      null,
      { ...valid, dbStat: 123 },
      { ...valid, stepCount: -1 },
      { ...valid, deltas: ["bad"] },
      { ...valid, deltas: [{ ...valid.deltas[0], tokens: "bad" }] },
      {
        ...valid,
        deltas: [{ ...valid.deltas[0], tokens: { ...valid.deltas[0]!.tokens, inputTokens: -1 } }],
      },
      { ...valid, snapshot: "bad" },
      { ...valid, snapshot: { invalid: true } },
      { ...valid, snapshot: { ...valid.snapshot!, model: 123 } },
    ];
    for (const bad of badCaches) {
      const opener = vi.fn((path: string) => new DatabaseSync(path, { readOnly: true }));
      const res = await readAntigravitySource([f.root], {
        opener,
        cache: { [f.path]: bad as never },
      });
      expect(opener).toHaveBeenCalledTimes(1);
      expect(res.dbCount).toBe(1);
    }

    // Null snapshot in valid cache is also accepted cleanly
    const fEmpty = await fixture();
    const emptyRes = await readAntigravitySource([fEmpty.root]);
    const openerEmpty = vi.fn((path: string) => new DatabaseSync(path, { readOnly: true }));
    const cachedEmpty = await readAntigravitySource([fEmpty.root], {
      opener: openerEmpty,
      cache: emptyRes.dbs,
    });
    expect(openerEmpty).not.toHaveBeenCalled();
    expect(cachedEmpty.snapshots).toEqual([]);
  });

  it("isolates busy DBs per file while failing closed on corrupt data", async () => {
    const f1 = await fixture(false, "a-stable.db");
    const f2 = await fixture(false, "b-busy.db");
    f1.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    f1.gen(1, [1], "gemini-3.1-pro");
    f2.step(1, metadata(1_700_000_010, { 2: 20, 3: 5 }));
    f2.gen(1, [1], "gemini-4-neon");

    const cold = await readAntigravitySource([f1.root, f2.root]);

    // 1. Cached busy DB retains cached snapshot while sibling updates cleanly
    f1.step(2, metadata(1_700_000_020, { 2: 30, 3: 5 }));
    f1.gen(2, [2], "gemini-3.1-pro");
    f2.step(2, metadata(1_700_000_030, { 2: 40, 3: 5 }));
    f2.gen(2, [2], "gemini-4-neon");
    const retained = await readAntigravitySource([f1.root, f2.root], {
      cache: cold.dbs,
      opener: (path) => {
        if (basename(path) === "b-busy.db") {
          f2.db
            .prepare("UPDATE steps SET metadata = ? WHERE idx = 2")
            .run(metadata(1_700_000_031, { 2: 50, 3: 5 }));
        }
        return new DatabaseSync(path, { readOnly: true });
      },
    });
    expect(retained.dbCount).toBe(2);
    expect(retained.stepCount).toBe(3); // 2 from updated a-stable + 1 retained from b-busy cache
    expect(retained.warnings).toEqual([
      "Retained cached snapshot for 1 busy Antigravity database(s)",
    ]);

    // 2. Uncached busy DB skipped when allowSkipUncachedUnstable is true & another DB succeeds
    const uncachedSkip = await readAntigravitySource([f1.root, f2.root], {
      allowSkipUncachedUnstable: true,
      opener: (path) => {
        if (basename(path) === "b-busy.db") {
          f2.db
            .prepare("UPDATE steps SET metadata = ? WHERE idx = 2")
            .run(metadata(1_700_000_032, { 2: 60, 3: 5 }));
        }
        return new DatabaseSync(path, { readOnly: true });
      },
    });
    expect(uncachedSkip.dbCount).toBe(1);
    expect(uncachedSkip.stepCount).toBe(2);
    expect(uncachedSkip.warnings).toEqual([
      "Skipped 1 busy Antigravity database(s); will retry next sync",
    ]);

    // 3. Uncached busy DB throws when allowSkipUncachedUnstable is true but 0 DBs succeed
    await expect(
      readAntigravitySource([f2.root], {
        allowSkipUncachedUnstable: true,
        opener: (path) => {
          f2.db
            .prepare("UPDATE steps SET metadata = ? WHERE idx = 2")
            .run(metadata(1_700_000_033, { 2: 70, 3: 5 }));
          return new DatabaseSync(path, { readOnly: true });
        },
      }),
    ).rejects.toBeInstanceOf(UnstableAntigravityError);

    // 4. Uncached busy DB throws when allowSkipUncachedUnstable is false
    await expect(
      readAntigravitySource([f1.root, f2.root], {
        allowSkipUncachedUnstable: false,
        opener: (path) => {
          if (basename(path) === "b-busy.db") {
            f2.db
              .prepare("UPDATE steps SET metadata = ? WHERE idx = 2")
              .run(metadata(1_700_000_034, { 2: 80, 3: 5 }));
          }
          return new DatabaseSync(path, { readOnly: true });
        },
      }),
    ).rejects.toBeInstanceOf(UnstableAntigravityError);

    // 5. DB disappearing between readdir and statIdentity triggers UnstableAntigravityError path
    const fTemp = await fixture(false, "c-vanish.db");
    fTemp.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    fTemp.gen(1, [1], "gemini-3.1-pro");
    fTemp.db.close();
    writers.splice(writers.indexOf(fTemp.db), 1);
    const vanished = await readAntigravitySource([f1.root, fTemp.root], {
      allowSkipUncachedUnstable: true,
      opener: (path) => {
        const inner = new DatabaseSync(path, { readOnly: true });
        if (basename(path) === "a-stable.db") {
          return {
            prepare: (sql: string) => inner.prepare(sql),
            close: () => {
              inner.close();
              rmSync(fTemp.path, { force: true });
            },
          };
        }
        return inner;
      },
    });
    expect(vanished.dbCount).toBe(1);
    expect(vanished.warnings).toEqual([
      "Skipped 1 busy Antigravity database(s); will retry next sync",
    ]);

    // 6. Corrupt data fails closed even when cache and allowSkipUncachedUnstable are enabled
    const fBad = await fixture(false, "z-corrupt.db");
    fBad.step(1, Buffer.from([128]));
    await expect(
      readAntigravitySource([f1.root, fBad.root], {
        cache: cold.dbs,
        allowSkipUncachedUnstable: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects unsupported SQLite schemas and missing model attribution", async () => {
    const f = await fixture();
    f.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/model/i);
    f.db.exec("DROP TABLE gen_metadata");
    await expect(readAntigravitySource([f.root])).rejects.toThrow();
  });

  it("rejects conflicting actual model names for the same usage step", async () => {
    const f = await fixture();
    f.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    f.gen(80, [1], "first");
    f.gen(81, [1], "second");
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/model/i);
  });

  it.each([
    scalar(1, 1),
    bytes(1, scalar(19, 1)),
    bytes(1, bytes(19, "")),
    bytes(1, bytes(19, "x".repeat(201))),
    bytes(1, bytes(19, "bad\nmodel")),
    bytes(1, bytes(19, Buffer.from([255]))),
    bytes(1, bytes(19, "https://private/path")),
    bytes(1, bytes(19, "sk-private")),
    bytes(1, bytes(19, "unknown")),
    Buffer.concat([bytes(1, bytes(19, "model")), scalar(2, 2_147_483_648)]),
    Buffer.concat([bytes(1, bytes(19, "model")), bytes(2, Buffer.from([128]))]),
    Buffer.concat([bytes(1, bytes(19, "model")), varint(2 * 8 + 5), Buffer.alloc(4)]),
    bytes(2, varint(1)),
  ])("rejects malformed or unknown generation models %#", async (data) => {
    const f = await fixture();
    f.step(1, metadata(1_700_000_000, { 2: 10, 3: 5 }));
    f.db.prepare("INSERT INTO gen_metadata VALUES (?,?)").run(1, data);
    await expect(readAntigravitySource([f.root])).rejects.toThrow();
  });

  it("rejects usage without timestamps and ignores completed zero-token steps", async () => {
    const f = await fixture();
    f.step(1, bytes(9, usage({ 2: 10, 3: 5 })));
    f.gen(99, [1]);
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/timestamp/i);
    f.db.prepare("UPDATE steps SET metadata = ?").run(bytes(9, usage({ 2: 0, 3: 0 })));
    expect((await readAntigravitySource([f.root])).deltas).toEqual([]);
  });

  it("rejects invalid SQL row types", async () => {
    const f = await fixture();
    f.db.prepare("INSERT INTO steps VALUES (?,?,?,?,?)").run(-1, 15, 3, metadata(), null);
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/step row/i);
  });

  it("hashes nested workspace folder_uri and allows empty sessions", async () => {
    const f = await fixture();
    f.db
      .prepare("UPDATE trajectory_metadata_blob SET data = ?")
      .run(bytes(1, bytes(1, "file:///another/project")));
    f.step(1, metadata(), 14);
    const result = await readAntigravitySource([f.root]);
    expect(result.deltas).toEqual([]);
    expect(result.snapshots[0].projectRef).toBe(hashProjectRef("file:///another/project"));
    f.db.exec("DELETE FROM steps");
    expect((await readAntigravitySource([f.root])).snapshots).toEqual([]);
  });

  it.each([bytes(7, ""), bytes(1, Buffer.alloc(0)), Buffer.alloc(0)])(
    "accepts absent workspace references %#",
    async (blob) => {
      const f = await fixture();
      f.db.prepare("UPDATE trajectory_metadata_blob SET data = ?").run(blob);
      f.step(1, metadata(), 14);
      expect((await readAntigravitySource([f.root])).snapshots[0].projectRef).toBeNull();
    },
  );

  it("rejects malformed workspace references", async () => {
    const f = await fixture();
    f.db.prepare("UPDATE trajectory_metadata_blob SET data = ?").run(scalar(7, 1));
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/workspace/i);
  });

  it("counts nullable metadata steps without inventing times or usage", async () => {
    const f = await fixture();
    f.step(1, metadata(), 14);
    f.db.prepare("INSERT INTO steps VALUES (?,?,?,?,?)").run(2, 15, 1, null, null);
    expect((await readAntigravitySource([f.root])).snapshots[0]).toMatchObject({
      userMessages: 1,
      assistantMessages: 1,
      totalMessages: 2,
    });
  });

  it("rejects sessions with durations beyond the ingest limit before returning token candidates", async () => {
    const f = await fixture();
    f.step(1, metadata(1), 14);
    f.step(2, metadata(315_576_002, { 2: 10, 3: 5 }));
    f.gen(3, [2]);
    await expect(readAntigravitySource([f.root])).rejects.toThrow(/session snapshot/i);
  });

  it("enforces session key, date, duration and message bounds", async () => {
    const f = await fixture();
    f.step(1, metadata(), 14);
    const snapshot = (await readAntigravitySource([f.root])).snapshots[0];
    expect(validateAntigravitySession(snapshot)).toBe(snapshot);
    for (const patch of [
      { sessionKey: "x".repeat(1025) },
      { sessionKey: "" },
      { model: "x".repeat(1025) },
      { startedAt: "10000-01-01T00:00:00.000Z" },
      { snapshotAt: "invalid" },
      { durationSeconds: 315_576_001 },
      { durationSeconds: -1 },
      { durationSeconds: 0.5 },
      { userMessages: 100_000_001 },
      { assistantMessages: -1 },
      { totalMessages: 0 },
      { lastMessageAt: "2020-01-01T00:00:00.000Z" },
    ])
      expect(() => validateAntigravitySession({ ...snapshot, ...patch })).toThrow(
        /session snapshot/i,
      );
  });
});

describe("Antigravity Protobuf metadata validation", () => {
  it("recognizes omitted proto3 cache and thinking scalars as known zero", () => {
    expect(decodeAntigravityMetadata(metadata(0, { 2: 10, 3: 5 }, 999_999)).timestamp).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(decodeAntigravityMetadata(metadata(1, { 2: 10, 3: 5 })).usage).toMatchObject({
      input: 10,
      output: 5,
      read: 0,
      write: 0,
      reasoning: 0,
    });
    expect(decodeAntigravityMetadata(metadata(1, { 2: 10, 3: 5, 5: 0, 9: 0 })).usage).toMatchObject(
      { read: 0, reasoning: 0 },
    );
  });

  it("validates turn_id field 12 wire type and UTF-8", () => {
    expect(decodeAntigravityMetadata(metadata(1, { 2: 10, 3: 5 }, 0, "  turn-123  ")).turnId).toBe(
      "turn-123",
    );
    expect(decodeAntigravityMetadata(metadata(1, { 2: 10, 3: 5 }, 0, "   ")).turnId).toBeNull();
    expect(() => decodeAntigravityMetadata(Buffer.concat([metadata(), scalar(12, 1)]))).toThrow(
      /turn id/i,
    );
    expect(() =>
      decodeAntigravityMetadata(Buffer.concat([metadata(), bytes(12, Buffer.from([255]))])),
    ).toThrow();
  });

  it.each([
    { 2: 1_000_000_001 },
    { 2: 1_000_000_000, 5: 1 },
    { 2: 1, 3: 1_000_000_000 },
    { 2: 10, 3: 5, 9: 6 },
    { 2: 10, 3: 5, 9: 2, 10: 4 },
    { 2: 10, 3: 5, 4: 1 },
    { 2: 0xffff_ffff_ffff_ffffn },
  ])("rejects unsafe or contradictory counters %#", (fields) => {
    expect(() => decodeAntigravityMetadata(metadata(1, fields))).toThrow();
  });

  it.each(
    [
      [0],
      [128],
      [8, 128],
      [10, 5, 1],
      [13, 1],
      [9, 1],
      [11],
      [8, ...Array(10).fill(255)],
      [8, ...Array(9).fill(128), 2],
      [varint(536_870_912 * 8), 0].flatMap((v) => (typeof v === "number" ? [v] : [...v])),
      [13, 1, 2, 3, 4, 99],
    ].map((raw) => ({ raw })),
  )("rejects malformed wire bytes $raw", ({ raw }) => {
    expect(() => decodeAntigravityMetadata(Buffer.from(raw))).toThrow();
  });

  it("rejects invalid timestamps, duplicate singular fields and wrong known wire types", () => {
    expect(() => decodeAntigravityMetadata(metadata(1, undefined, 1_000_000_000))).toThrow();
    expect(() => decodeAntigravityMetadata(metadata(253_402_300_800))).toThrow();
    expect(() => decodeAntigravityMetadata(Buffer.concat([metadata(), metadata()]))).toThrow();
    expect(() => decodeAntigravityMetadata(Buffer.concat([metadata(), scalar(9, 1)]))).toThrow();
    expect(() => decodeAntigravityMetadata(bytes(9, bytes(2, "wrong")))).toThrow();
    expect(() => decodeAntigravityMetadata(bytes(1, bytes(1, "wrong")))).toThrow();
    expect(() =>
      decodeAntigravityMetadata(Buffer.concat([varint(1 * 8 + 1), Buffer.alloc(8)])),
    ).toThrow();
    expect(() =>
      decodeAntigravityMetadata(bytes(1, Buffer.concat([varint(1 * 8 + 5), Buffer.alloc(4)]))),
    ).toThrow();
    expect(() =>
      decodeAntigravityMetadata(bytes(1, scalar(1, BigInt.asUintN(64, -62_135_596_801n)))),
    ).toThrow();
    expect(() => decodeAntigravityMetadata(null as unknown as Uint8Array)).toThrow();
  });

  it("supports protobuf epoch defaults and signed timestamps", () => {
    expect(decodeAntigravityMetadata(bytes(1, Buffer.alloc(0))).timestamp).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(decodeAntigravityMetadata(bytes(1, scalar(1, BigInt.asUintN(64, -1n)))).timestamp).toBe(
      "1969-12-31T23:59:59.000Z",
    );
    expect(decodeAntigravityMetadata(bytes(9, Buffer.alloc(0))).usage).toMatchObject({
      input: 0,
      output: 0,
    });
  });

  it("skips unknown opaque, fixed32 and fixed64 fields without decoding their contents", () => {
    const decoded = decodeAntigravityMetadata(
      Buffer.concat([
        metadata(1, { 2: 10, 3: 5 }),
        bytes(50, Buffer.from([255, 255])),
        varint(51 * 8 + 1),
        Buffer.alloc(8),
        varint(52 * 8 + 5),
        Buffer.alloc(4),
        scalar(53, 1),
      ]),
    );
    expect(decoded.usage?.input).toBe(10);
  });
});

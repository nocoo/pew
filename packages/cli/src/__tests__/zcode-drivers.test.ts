import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ZcodeSqliteCursor,
  ZcodeSqliteSessionCursor,
} from "@pew/core";
import { createZcodeSqliteTokenDriver } from "../drivers/token/zcode-sqlite-token-driver.js";
import { createZcodeSqliteSessionDriver } from "../drivers/session/zcode-sqlite-session-driver.js";
import type {
  ZcodeUsageDb,
  ZcodeSessionDb,
  ZcodeUsageRow,
  ZcodeSessionRow,
} from "../parsers/zcode-types.js";

let tempDir: string;
let dbPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pew-zcode-driver-"));
  dbPath = join(tempDir, "db.sqlite");
  await writeFile(dbPath, "placeholder");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const localRow: ZcodeUsageRow = {
  id: "u1",
  sessionId: "sess_a",
  turnId: "turn_a",
  modelId: "GLM-5.2",
  providerId: "builtin:bigmodel-coding-plan",
  status: "completed",
  startedAt: 1000,
  completedAt: 2000,
  inputTokens: 11933,
  outputTokens: 170,
  reasoningTokens: 0,
  cacheReadInputTokens: 7360,
  cacheCreationInputTokens: 0,
  providerTotalTokens: 12103,
  computedTotalTokens: 12103,
};

const sessionRow: ZcodeSessionRow = {
  id: "sess_a",
  directory: "/proj/dir",
  title: "hello",
  timeCreated: 1000,
  timeUpdated: 2000,
  taskType: "interactive",
};

function makeUsageDb(rows: ZcodeUsageRow[]): ZcodeUsageDb & { closed: boolean } {
  const state = {
    closed: false,
    queryUsageRows(lastCompletedAt: number | null, skipIds: readonly string[]) {
      const watermark = lastCompletedAt ?? 0;
      const skip = new Set(skipIds);
      return rows.filter((r) => r.completedAt >= watermark && !skip.has(r.id));
    },
    close() {
      state.closed = true;
    },
  };
  return state;
}

function makeSessionDb(
  rows: ZcodeSessionRow[],
): ZcodeSessionDb & { closed: boolean } {
  const state = {
    closed: false,
    querySessions(
      lastTimeUpdated: number | null,
      skipIds: readonly string[],
    ) {
      const watermark = lastTimeUpdated ?? 0;
      const skip = new Set(skipIds);
      return rows.filter((r) => r.timeUpdated >= watermark && !skip.has(r.id));
    },
    queryMessages() {
      return { user: 1, assistant: 4, total: 5 };
    },
    queryPrimaryModel() {
      return "GLM-5.2";
    },
    close() {
      state.closed = true;
    },
  };
  return state;
}

describe("createZcodeSqliteTokenDriver", () => {
  it("returns empty result when db file is missing", async () => {
    const missingPath = join(tempDir, "does-not-exist.sqlite");
    const opener = vi.fn();
    const driver = createZcodeSqliteTokenDriver({
      dbPath: missingPath,
      openZcodeDb: opener,
    });
    const result = await driver.run(undefined, { messageKeys: new Set() });
    expect(result.deltas).toHaveLength(0);
    expect(result.rowCount).toBe(0);
    expect(opener).not.toHaveBeenCalled();
  });

  it("returns empty result when opener returns null", async () => {
    const opener = vi.fn().mockReturnValue(null);
    const driver = createZcodeSqliteTokenDriver({
      dbPath,
      openZcodeDb: opener,
    });
    const result = await driver.run(undefined, { messageKeys: new Set() });
    expect(result.deltas).toHaveLength(0);
    expect(opener).toHaveBeenCalledOnce();
    // cursor.inode has been populated from stat().
    expect(result.cursor.inode).toBeGreaterThan(0);
  });

  it("produces deltas + closes handle when opener returns a handle", async () => {
    const handle = makeUsageDb([localRow]);
    const driver = createZcodeSqliteTokenDriver({
      dbPath,
      openZcodeDb: () => handle,
    });
    const result = await driver.run(undefined, { messageKeys: new Set() });
    expect(result.deltas).toHaveLength(1);
    expect(result.rowCount).toBe(1);
    expect(result.cursor.lastCompletedAt).toBe(2000);
    expect(result.cursor.lastProcessedIds).toEqual(["u1"]);
    expect(handle.closed).toBe(true);
  });

  it("resets cursor when inode changes", async () => {
    // First run: capture inode.
    const handle = makeUsageDb([localRow]);
    const driver = createZcodeSqliteTokenDriver({
      dbPath,
      openZcodeDb: () => handle,
    });
    const r1 = await driver.run(undefined, { messageKeys: new Set() });
    const firstInode = r1.cursor.inode;

    // Simulate inode change: rename+recreate.
    await rename(dbPath, `${dbPath}.bak`);
    await writeFile(dbPath, "different-content-so-inode-differs");

    // Feed the driver a cursor whose inode disagrees with the fresh file.
    const staleCursor: ZcodeSqliteCursor = {
      ...r1.cursor,
      inode: firstInode + 12345,
      lastCompletedAt: 9999,
      lastProcessedIds: ["stale"],
    };
    const capturedArgs: Array<[number | null, readonly string[]]> = [];
    const spyHandle: ZcodeUsageDb = {
      queryUsageRows(lastCompletedAt, skipIds) {
        capturedArgs.push([lastCompletedAt, skipIds]);
        return [];
      },
      close() {},
    };
    const driver2 = createZcodeSqliteTokenDriver({
      dbPath,
      openZcodeDb: () => spyHandle,
    });
    await driver2.run(staleCursor, { messageKeys: new Set() });
    // inode mismatch → parser called with null (full rescan).
    expect(capturedArgs[0][0]).toBeNull();
    expect(capturedArgs[0][1]).toEqual([]);
  });

  it("propagates driver-run exceptions (orchestrator catches, not the driver)", async () => {
    const badHandle: ZcodeUsageDb = {
      queryUsageRows() {
        throw new Error("boom");
      },
      close() {},
    };
    const driver = createZcodeSqliteTokenDriver({
      dbPath,
      openZcodeDb: () => badHandle,
    });
    await expect(
      driver.run(undefined, { messageKeys: new Set() }),
    ).rejects.toThrow("boom");
  });

  it("merges same-ms boundary IDs across 3 syncs: A → A+B → A+B+A' (regression)", async () => {
    // Every row shares completedAt = 2000. Between syncs we add new rows
    // (still at the same ms). The driver must keep every prior boundary ID
    // so we never re-emit a row that was already handled.
    const state: ZcodeUsageRow[] = [{ ...localRow, id: "A", completedAt: 2000 }];
    const handleState: ZcodeUsageDb = {
      queryUsageRows(lastCompletedAt, skipIds) {
        const watermark = lastCompletedAt ?? 0;
        const skip = new Set(skipIds);
        return state.filter(
          (r) => r.completedAt >= watermark && !skip.has(r.id),
        );
      },
      close() {},
    };
    const driver = createZcodeSqliteTokenDriver({
      dbPath,
      openZcodeDb: () => handleState,
    });

    // Sync 1: only A. Cursor learns wm=2000, ids=[A].
    const r1 = await driver.run(undefined, { messageKeys: new Set() });
    expect(r1.deltas).toHaveLength(1);
    expect(r1.cursor.lastCompletedAt).toBe(2000);
    expect(r1.cursor.lastProcessedIds).toEqual(["A"]);

    // Sync 2: B appears at the same completedAt. Only B must emit; cursor
    // must remember BOTH A and B so A won't come back if it reappears.
    state.push({ ...localRow, id: "B", completedAt: 2000 });
    const r2 = await driver.run(r1.cursor, { messageKeys: new Set() });
    expect(r2.deltas.map((d) => d.tokens.inputTokens)).toHaveLength(1);
    expect(r2.cursor.lastCompletedAt).toBe(2000);
    expect(new Set(r2.cursor.lastProcessedIds)).toEqual(new Set(["A", "B"]));

    // Sync 3: A' (a fresh same-ms row) appears. A / B stay put — cursor
    // must repel both. A' must emit exactly once and be remembered.
    state.push({ ...localRow, id: "A_prime", completedAt: 2000 });
    const r3 = await driver.run(r2.cursor, { messageKeys: new Set() });
    expect(r3.deltas).toHaveLength(1);
    expect(r3.cursor.lastCompletedAt).toBe(2000);
    expect(new Set(r3.cursor.lastProcessedIds)).toEqual(
      new Set(["A", "B", "A_prime"]),
    );

    // Sync 4 (idempotency): nothing new. All three IDs stay in the cursor.
    const r4 = await driver.run(r3.cursor, { messageKeys: new Set() });
    expect(r4.deltas).toHaveLength(0);
    expect(r4.cursor.lastCompletedAt).toBe(2000);
    expect(new Set(r4.cursor.lastProcessedIds)).toEqual(
      new Set(["A", "B", "A_prime"]),
    );
  });
});

describe("createZcodeSqliteSessionDriver", () => {
  it("returns empty result when db is missing", async () => {
    const missingPath = join(tempDir, "does-not-exist.sqlite");
    const opener = vi.fn();
    const driver = createZcodeSqliteSessionDriver({
      dbPath: missingPath,
      openZcodeSessionDb: opener,
    });
    const result = await driver.run(undefined, { messageKeys: new Set() });
    expect(result.snapshots).toHaveLength(0);
    expect(opener).not.toHaveBeenCalled();
  });

  it("emits snapshot + advances cursor", async () => {
    const handle = makeSessionDb([sessionRow]);
    const driver = createZcodeSqliteSessionDriver({
      dbPath,
      openZcodeSessionDb: () => handle,
    });
    const result = await driver.run(undefined, { messageKeys: new Set() });
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].sessionKey).toBe("zcode:sess_a");
    expect(result.cursor.lastTimeUpdated).toBe(2000);
    expect(result.cursor.lastProcessedIds).toEqual(["sess_a"]);
    expect(handle.closed).toBe(true);
  });

  it("resets cursor on inode change", async () => {
    const handle = makeSessionDb([sessionRow]);
    const driver = createZcodeSqliteSessionDriver({
      dbPath,
      openZcodeSessionDb: () => handle,
    });
    const r1 = await driver.run(undefined, { messageKeys: new Set() });

    const staleCursor: ZcodeSqliteSessionCursor = {
      ...r1.cursor,
      inode: r1.cursor.inode + 42,
      lastTimeUpdated: 999,
      lastProcessedIds: ["ghost"],
    };
    const capturedArgs: Array<[number | null, readonly string[]]> = [];
    const spyHandle: ZcodeSessionDb = {
      querySessions(lastTimeUpdated, skipIds) {
        capturedArgs.push([lastTimeUpdated, skipIds]);
        return [];
      },
      queryMessages: () => ({ user: 0, assistant: 0, total: 0 }),
      queryPrimaryModel: () => null,
      close() {},
    };
    const driver2 = createZcodeSqliteSessionDriver({
      dbPath,
      openZcodeSessionDb: () => spyHandle,
    });
    await driver2.run(staleCursor, { messageKeys: new Set() });
    expect(capturedArgs[0][0]).toBeNull();
    expect(capturedArgs[0][1]).toEqual([]);
  });

  it("merges same-ms boundary session IDs across 3 syncs (regression)", async () => {
    const rows: ZcodeSessionRow[] = [
      { ...sessionRow, id: "S_a", timeUpdated: 2000 },
    ];
    const handle: ZcodeSessionDb = {
      querySessions(lastTimeUpdated, skipIds) {
        const watermark = lastTimeUpdated ?? 0;
        const skip = new Set(skipIds);
        return rows.filter(
          (r) => r.timeUpdated >= watermark && !skip.has(r.id),
        );
      },
      queryMessages: () => ({ user: 1, assistant: 4, total: 5 }),
      queryPrimaryModel: () => "GLM-5.2",
      close() {},
    };
    const driver = createZcodeSqliteSessionDriver({
      dbPath,
      openZcodeSessionDb: () => handle,
    });

    const r1 = await driver.run(undefined, { messageKeys: new Set() });
    expect(r1.cursor.lastTimeUpdated).toBe(2000);
    expect(r1.cursor.lastProcessedIds).toEqual(["S_a"]);

    rows.push({ ...sessionRow, id: "S_b", timeUpdated: 2000 });
    const r2 = await driver.run(r1.cursor, { messageKeys: new Set() });
    expect(r2.snapshots).toHaveLength(1);
    expect(new Set(r2.cursor.lastProcessedIds)).toEqual(
      new Set(["S_a", "S_b"]),
    );

    rows.push({ ...sessionRow, id: "S_c_prime", timeUpdated: 2000 });
    const r3 = await driver.run(r2.cursor, { messageKeys: new Set() });
    expect(r3.snapshots).toHaveLength(1);
    expect(new Set(r3.cursor.lastProcessedIds)).toEqual(
      new Set(["S_a", "S_b", "S_c_prime"]),
    );
  });
});

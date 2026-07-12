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
    await rename(dbPath, dbPath + ".bak");
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
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { createOpenCodeSqliteTokenDriver } from "../../../drivers/token/opencode-sqlite-token-driver.js";
import type { OpenCodeSqliteCursor } from "@pew/core";
import type { SyncContext } from "../../../drivers/types.js";
import type { MessageRow } from "../../../parsers/opencode-sqlite.js";

/** Helper: create a mock MessageRow */
function mockRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "msg-001",
    session_id: "ses-001",
    time_created: 1709827200000,
    role: "assistant",
    data: JSON.stringify({
      modelID: "claude-sonnet-4-20250514",
      time: {
        created: 1709827200,
        completed: 1709827260,
      },
      tokens: {
        input: 500,
        output: 200,
        cache: { read: 0, write: 0 },
        reasoning: 0,
      },
    }),
    ...overrides,
  };
}

describe("openCodeSqliteTokenDriver", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-opencode-sqlite-driver-"));
    dbPath = join(tempDir, "messages.db");
    // Create a fake DB file (we mock the actual DB operations)
    await writeFile(dbPath, "fake-sqlite-content");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    const driver = createOpenCodeSqliteTokenDriver({
      dbPath,
      openMessageDb: () => null,
    });
    expect(driver.kind).toBe("db");
    expect(driver.source).toBe("opencode");
  });

  it("returns empty result when DB file does not exist", async () => {
    const driver = createOpenCodeSqliteTokenDriver({
      dbPath: join(tempDir, "nonexistent.db"),
      openMessageDb: () => null,
    });

    const ctx: SyncContext = {};
    const result = await driver.run(undefined, ctx);

    expect(result.deltas).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.cursor.lastTimeCreated).toBe(0);
  });

  it("returns empty result when openMessageDb returns null", async () => {
    const driver = createOpenCodeSqliteTokenDriver({
      dbPath,
      openMessageDb: () => null,
    });

    const ctx: SyncContext = {};
    const result = await driver.run(undefined, ctx);

    expect(result.deltas).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it("processes messages from DB and returns deltas + cursor", async () => {
    const rows: MessageRow[] = [
      mockRow({ id: "msg-001", time_created: 1709827200000 }),
      mockRow({ id: "msg-002", time_created: 1709827300000 }),
    ];

    let closeCalled = false;
    const driver = createOpenCodeSqliteTokenDriver({
      dbPath,
      openMessageDb: () => ({
        queryMessages: (_lastTime: number) => rows,
        close: () => {
          closeCalled = true;
        },
      }),
    });

    const ctx: SyncContext = {};
    const result = await driver.run(undefined, ctx);

    expect(result.deltas.length).toBeGreaterThanOrEqual(1);
    expect(result.rowCount).toBe(2);
    expect(result.cursor.lastTimeCreated).toBe(1709827300000);
    expect(result.cursor.lastProcessedIds).toEqual(["msg-002"]);
    expect(closeCalled).toBe(true);
  });

  it("deduplicates using ctx.messageKeys from JSON driver", async () => {
    const rows: MessageRow[] = [
      mockRow({ id: "msg-001", session_id: "ses-001", time_created: 1709827200000 }),
    ];

    const driver = createOpenCodeSqliteTokenDriver({
      dbPath,
      openMessageDb: () => ({
        queryMessages: (_lastTime: number) => rows,
        close: () => {},
      }),
    });

    // The JSON driver deposited this messageKey → SQLite should skip it
    const ctx: SyncContext = {
      messageKeys: new Set(["ses-001|msg-001"]),
    };
    const result = await driver.run(undefined, ctx);

    // The row is an assistant message with matching messageKey → deduped
    expect(result.deltas).toEqual([]);
    expect(result.rowCount).toBe(1); // raw rows still counted
    expect(result.cursor.lastTimeCreated).toBe(1709827200000);
  });

  it("resumes from previous cursor watermark", async () => {
    const dbStat = await stat(dbPath);
    const prevCursor: OpenCodeSqliteCursor = {
      lastTimeCreated: 1709827200000,
      lastProcessedIds: ["msg-001"],
      lastSessionUpdated: 0,
      inode: dbStat.ino,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    // queryMessages returns 2 rows: msg-001 at watermark, msg-002 new
    const rows: MessageRow[] = [
      mockRow({ id: "msg-001", time_created: 1709827200000 }),
      mockRow({ id: "msg-002", time_created: 1709827400000 }),
    ];

    const driver = createOpenCodeSqliteTokenDriver({
      dbPath,
      openMessageDb: () => ({
        queryMessages: (lastTime: number) => {
          // Should be called with the watermark
          expect(lastTime).toBe(1709827200000);
          return rows;
        },
        close: () => {},
      }),
    });

    const ctx: SyncContext = {};
    const result = await driver.run(prevCursor, ctx);

    // msg-001 should be filtered by lastProcessedIds
    expect(result.rowCount).toBe(2); // raw count includes all
    // Only msg-002 should produce deltas (msg-001 deduped by lastProcessedIds)
    expect(result.cursor.lastTimeCreated).toBe(1709827400000);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeSqliteSessionDriver } from "../../../drivers/session/opencode-sqlite-session-driver.js";
import type { OpenCodeSqliteSessionCursor } from "@pew/core";
import type { SessionRow, SessionMessageRow } from "../../../parsers/opencode-sqlite-session.js";
import type { SyncContext } from "../../../drivers/types.js";

describe("openCodeSqliteSessionDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-oc-sqlite-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    const driver = createOpenCodeSqliteSessionDriver({
      dbPath: join(tempDir, "opencode.db"),
      openSessionDb: () => null,
    });
    expect(driver.kind).toBe("db");
    expect(driver.source).toBe("opencode");
  });

  it("returns empty when DB file does not exist", async () => {
    const driver = createOpenCodeSqliteSessionDriver({
      dbPath: join(tempDir, "nonexistent.db"),
      openSessionDb: () => null,
    });
    const result = await driver.run(undefined, ctx);
    expect(result.snapshots).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it("returns empty when openSessionDb returns null", async () => {
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "fake-sqlite-content");

    const driver = createOpenCodeSqliteSessionDriver({
      dbPath,
      openSessionDb: () => null,
    });
    const result = await driver.run(undefined, ctx);
    expect(result.snapshots).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.cursor.inode).toBeGreaterThan(0);
  });

  it("queries sessions and returns snapshots", async () => {
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "fake-sqlite-content");

    const sessions: SessionRow[] = [
      { id: "ses-1", project_id: null, title: "Test", time_created: 1735689600000, time_updated: 1735689700000 },
    ];
    const messages: SessionMessageRow[] = [
      { session_id: "ses-1", role: "user", time_created: 1735689600000, data: JSON.stringify({ time: { created: 1735689600000 } }) },
      {
        session_id: "ses-1",
        role: "assistant",
        time_created: 1735689660000,
        data: JSON.stringify({
          time: { created: 1735689660000, completed: 1735689700000 },
          modelID: "anthropic/claude-sonnet",
        }),
      },
    ];

    let closed = false;
    const driver = createOpenCodeSqliteSessionDriver({
      dbPath,
      openSessionDb: () => ({
        querySessions: () => sessions,
        querySessionMessages: () => messages,
        close: () => { closed = true; },
      }),
    });

    const result = await driver.run(undefined, ctx);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].sessionKey).toBe("opencode:ses-1");
    expect(result.snapshots[0].source).toBe("opencode");
    expect(result.snapshots[0].userMessages).toBe(1);
    expect(result.snapshots[0].assistantMessages).toBe(1);
    expect(result.cursor.lastTimeUpdated).toBe(1735689700000);
    expect(result.cursor.lastProcessedIds).toEqual(["ses-1"]);
    expect(result.rowCount).toBe(1);
    expect(closed).toBe(true);
  });

  it("deduplicates previously processed sessions", async () => {
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "fake-sqlite-content");
    const { ino: dbInode } = await import("node:fs/promises").then((fs) => fs.stat(dbPath));

    const sessions: SessionRow[] = [
      { id: "ses-1", project_id: null, title: "Old", time_created: 1735689500000, time_updated: 1735689600000 },
      { id: "ses-2", project_id: null, title: "New", time_created: 1735689600000, time_updated: 1735689700000 },
    ];

    const driver = createOpenCodeSqliteSessionDriver({
      dbPath,
      openSessionDb: () => ({
        querySessions: () => sessions,
        querySessionMessages: () => [
          { session_id: "ses-2", role: "user", time_created: 1735689600000, data: JSON.stringify({ time: { created: 1735689600000 } }) },
        ],
        close: () => {},
      }),
    });

    const prevCursor: OpenCodeSqliteSessionCursor = {
      lastTimeUpdated: 1735689600000,
      lastProcessedIds: ["ses-1"],
      inode: dbInode,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = await driver.run(prevCursor, ctx);
    // ses-1 is filtered out by dedup, only ses-2 remains
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].sessionKey).toBe("opencode:ses-2");
    expect(result.cursor.lastTimeUpdated).toBe(1735689700000);
  });

  it("resets cursor when inode changes", async () => {
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "fake-sqlite-content");

    const sessions: SessionRow[] = [
      { id: "ses-1", project_id: null, title: "Test", time_created: 1735689600000, time_updated: 1735689700000 },
    ];

    let queriedWatermark = -1;
    const driver = createOpenCodeSqliteSessionDriver({
      dbPath,
      openSessionDb: () => ({
        querySessions: (ts: number) => { queriedWatermark = ts; return sessions; },
        querySessionMessages: () => [
          { session_id: "ses-1", role: "user", time_created: 1735689600000, data: JSON.stringify({ time: { created: 1735689600000 } }) },
        ],
        close: () => {},
      }),
    });

    // Cursor with different inode — should reset watermark to 0
    const prevCursor: OpenCodeSqliteSessionCursor = {
      lastTimeUpdated: 1735689600000,
      lastProcessedIds: ["ses-old"],
      inode: 99999,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    await driver.run(prevCursor, ctx);
    expect(queriedWatermark).toBe(0);
  });

  it("defaults lastProcessedIds to [] when missing from prevCursor (⌀ fallback)", async () => {
    // Exercises the `prevCursor.lastProcessedIds ?? []` branch when the field is
    // missing on a same-inode cursor (e.g. a cursor written by an older version).
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "fake-sqlite-content");
    const { ino: dbInode } = await import("node:fs/promises").then((fs) => fs.stat(dbPath));

    const sessions: SessionRow[] = [
      { id: "ses-1", project_id: null, title: "Test", time_created: 1735689600000, time_updated: 1735689700000 },
    ];

    const driver = createOpenCodeSqliteSessionDriver({
      dbPath,
      openSessionDb: () => ({
        querySessions: () => sessions,
        querySessionMessages: () => [
          { session_id: "ses-1", role: "user", time_created: 1735689600000, data: JSON.stringify({ time: { created: 1735689600000 } }) },
        ],
        close: () => {},
      }),
    });

    // Cursor without lastProcessedIds (older format).
    const prevCursor = {
      lastTimeUpdated: 1735689500000,
      inode: dbInode,
      updatedAt: "2026-01-01T00:00:00Z",
    } as OpenCodeSqliteSessionCursor;

    const result = await driver.run(prevCursor, ctx);
    // No dedup IDs → the lone session is processed normally.
    expect(result.snapshots).toHaveLength(1);
  });

  it("keeps prevCursor.lastTimeUpdated when querySessions returns no rows", async () => {
    // Exercises the `rawSessions.length > 0 ? ... : lastTimeUpdated` false branch.
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "fake-sqlite-content");
    const { ino: dbInode } = await import("node:fs/promises").then((fs) => fs.stat(dbPath));

    const driver = createOpenCodeSqliteSessionDriver({
      dbPath,
      openSessionDb: () => ({
        querySessions: () => [], // no new sessions → rawSessions is empty
        querySessionMessages: () => [],
        close: () => {},
      }),
    });

    const prevCursor: OpenCodeSqliteSessionCursor = {
      lastTimeUpdated: 1735689600000,
      lastProcessedIds: ["ses-a"],
      inode: dbInode,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = await driver.run(prevCursor, ctx);
    expect(result.snapshots).toHaveLength(0);
    // Cursor watermark falls back to the previous lastTimeUpdated.
    expect(result.cursor.lastTimeUpdated).toBe(1735689600000);
  });
});

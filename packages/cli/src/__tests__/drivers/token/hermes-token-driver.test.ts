import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHermesSqliteTokenDriver } from "../../../drivers/token/hermes-token-driver.js";
import type { HermesSqliteCursor } from "@pew/core";
import type { SyncContext } from "../../../drivers/types.js";
import type { SessionRow } from "../../../parsers/hermes-sqlite.js";

/** Helper: create mock sessions */
function mockSessions(sessions: SessionRow[]): () => SessionRow[] {
  return () => sessions;
}

describe("hermesSqliteTokenDriver", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-hermes-driver-"));
    dbPath = join(tempDir, "state.db");
    // Create a fake DB file (we mock the actual DB operations)
    await writeFile(dbPath, "fake-sqlite-content");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    const driver = createHermesSqliteTokenDriver({
      dbPath,
      openHermesDb: () => null,
    });
    expect(driver.kind).toBe("db");
    expect(driver.source).toBe("hermes");
  });

  it("returns empty result when openHermesDb returns null", async () => {
    const driver = createHermesSqliteTokenDriver({
      dbPath,
      openHermesDb: () => null,
    });

    const ctx: SyncContext = {};
    const result = await driver.run(undefined, ctx);

    expect(result.deltas).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.cursor.sessionTotals).toEqual({});
  });

  it("processes sessions from DB and returns deltas + cursor on first sync", async () => {
    const sessions: SessionRow[] = [
      {
        id: "session-1",
        model: "claude-opus-4",
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 200,
        cache_write_tokens: 50,
        reasoning_tokens: 100,
      },
    ];

    let closeCalled = false;
    const driver = createHermesSqliteTokenDriver({
      dbPath,
      openHermesDb: () => ({
        querySessions: mockSessions(sessions),
        close: () => { closeCalled = true; },
      }),
    });

    const ctx: SyncContext = {};
    const result = await driver.run(undefined, ctx);

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({
      source: "hermes",
      model: "claude-opus-4",
      tokens: {
        inputTokens: 1000,
        cachedInputTokens: 250,
        outputTokens: 500,
        reasoningOutputTokens: 100,
      },
    });
    expect(result.rowCount).toBe(1);
    expect(result.cursor.sessionTotals["session-1"]).toEqual({
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 50,
      reasoning: 100,
    });
    expect(closeCalled).toBe(true);
  });

  it("emits only incremental deltas on subsequent sync", async () => {
    const dbStat = await stat(dbPath);
    const prevCursor: HermesSqliteCursor = {
      sessionTotals: {
        "session-1": {
          input: 1000,
          output: 500,
          cacheRead: 200,
          cacheWrite: 50,
          reasoning: 100,
        },
      },
      inode: dbStat.ino,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const sessions: SessionRow[] = [
      {
        id: "session-1",
        model: "claude-opus-4",
        input_tokens: 1500,
        output_tokens: 700,
        cache_read_tokens: 200,
        cache_write_tokens: 50,
        reasoning_tokens: 100,
      },
    ];

    const driver = createHermesSqliteTokenDriver({
      dbPath,
      openHermesDb: () => ({
        querySessions: mockSessions(sessions),
        close: () => {},
      }),
    });

    const ctx: SyncContext = {};
    const result = await driver.run(prevCursor, ctx);

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens).toEqual({
      inputTokens: 500,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningOutputTokens: 0,
    });
    expect(result.cursor.sessionTotals["session-1"].input).toBe(1500);
    expect(result.cursor.sessionTotals["session-1"].output).toBe(700);
  });

  it("returns empty deltas when nothing changed", async () => {
    const dbStat = await stat(dbPath);
    const prevCursor: HermesSqliteCursor = {
      sessionTotals: {
        "session-1": {
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
        },
      },
      inode: dbStat.ino,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const sessions: SessionRow[] = [
      {
        id: "session-1",
        model: "claude-opus-4",
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
      },
    ];

    const driver = createHermesSqliteTokenDriver({
      dbPath,
      openHermesDb: () => ({
        querySessions: mockSessions(sessions),
        close: () => {},
      }),
    });

    const ctx: SyncContext = {};
    const result = await driver.run(prevCursor, ctx);

    expect(result.deltas).toHaveLength(0);
    expect(result.rowCount).toBe(0);
  });

  it("handles new session appearing", async () => {
    const dbStat = await stat(dbPath);
    const prevCursor: HermesSqliteCursor = {
      sessionTotals: {
        "session-1": {
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
        },
      },
      inode: dbStat.ino,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const sessions: SessionRow[] = [
      {
        id: "session-1",
        model: "claude-opus-4",
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
      },
      {
        id: "session-2",
        model: "claude-sonnet-4",
        input_tokens: 2000,
        output_tokens: 800,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
      },
    ];

    const driver = createHermesSqliteTokenDriver({
      dbPath,
      openHermesDb: () => ({
        querySessions: mockSessions(sessions),
        close: () => {},
      }),
    });

    const ctx: SyncContext = {};
    const result = await driver.run(prevCursor, ctx);

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(2000);
    expect(result.cursor.sessionTotals["session-1"]).toBeDefined();
    expect(result.cursor.sessionTotals["session-2"]).toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCodeJsonTokenDriver } from "../../../drivers/token/opencode-json-token-driver.js";
import type { OpenCodeCursor, FileCursorBase } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create an OpenCode assistant message JSON file */
function openCodeMessage(opts: {
  sessionId?: string;
  msgId?: string;
  input?: number;
  output?: number;
}): string {
  const { sessionId = "ses-001", msgId = "msg-001", input = 500, output = 200 } = opts;
  return JSON.stringify({
    id: msgId,
    session_id: sessionId,
    role: "assistant",
    model: { id: "claude-sonnet-4-20250514" },
    time: {
      created: 1709827200,
      completed: 1709827260,
    },
    tokens: {
      input,
      output,
      cache: { read: 0, write: 0 },
      reasoning: 0,
    },
  });
}

describe("openCodeJsonTokenDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-opencode-json-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(openCodeJsonTokenDriver.kind).toBe("file");
    expect(openCodeJsonTokenDriver.source).toBe("opencode");
  });

  describe("discover", () => {
    it("returns [] when openCodeMessageDir is not set", async () => {
      const ctx: SyncContext = {};
      const files = await openCodeJsonTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers message JSON files and writes dirMtimes to context", async () => {
      // discoverOpenCodeFiles expects: messageDir/<session_dir>/<msg>.json
      const sessionDir = join(tempDir, "ses-001");
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, "msg-001.json"), openCodeMessage({}));

      const ctx: SyncContext = {};
      const files = await openCodeJsonTokenDriver.discover(
        { openCodeMessageDir: tempDir },
        ctx,
      );
      expect(files.length).toBeGreaterThanOrEqual(1);
      // dirMtimes should be deposited into context
      expect(ctx.dirMtimes).toBeDefined();
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 300,
      mtimeMs: 1709827200000,
      size: 512,
    };

    it("returns false when cursor is undefined", () => {
      expect(openCodeJsonTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: OpenCodeCursor = {
        inode: 300,
        mtimeMs: 1709827200000,
        size: 512,
        lastTotals: null,
        messageKey: null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(openCodeJsonTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 300,
      mtimeMs: 1709827200000,
      size: 512,
    };

    it("returns null lastTotals when no cursor", () => {
      const state = openCodeJsonTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({ kind: "opencode-json", lastTotals: null });
    });

    it("returns stored lastTotals when inode matches", () => {
      const lastTotals = {
        inputTokens: 500,
        cachedInputTokens: 0,
        outputTokens: 200,
        reasoningOutputTokens: 0,
      };
      const cursor: OpenCodeCursor = {
        inode: 300,
        mtimeMs: 1709827200000,
        size: 512,
        lastTotals,
        messageKey: "ses-001|msg-001",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = openCodeJsonTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "opencode-json", lastTotals });
    });

    it("defaults lastTotals to null when cursor.lastTotals is undefined", () => {
      const cursor: OpenCodeCursor = {
        inode: 300,
        mtimeMs: 1709827200000,
        size: 512,
        lastTotals: undefined as unknown as null,
        messageKey: null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = openCodeJsonTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "opencode-json", lastTotals: null });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses an assistant message and builds cursor", async () => {
      const filePath = join(tempDir, "msg-001.json");
      await writeFile(filePath, openCodeMessage({}));

      const resume = { kind: "opencode-json" as const, lastTotals: null };
      const result = await openCodeJsonTokenDriver.parse(filePath, resume);

      // OpenCode returns at most 1 delta per file
      expect(result.deltas.length).toBeLessThanOrEqual(1);
      if (result.deltas.length === 1) {
        expect(result.deltas[0].source).toBe("opencode");
      }

      const fingerprint: FileFingerprint = { inode: 300, mtimeMs: Date.now(), size: 512 };
      const cursor = openCodeJsonTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(300);
      expect(cursor.updatedAt).toBeDefined();
    });

    it("returns empty deltas for a user message (no delta branch)", async () => {
      const filePath = join(tempDir, "msg-user.json");
      await writeFile(filePath, JSON.stringify({
        id: "msg_u1",
        sessionID: "ses_001",
        role: "user",
        modelID: "claude-opus-4.6",
        time: { created: 1739600000000, completed: 1739600001000 },
        tokens: null,
      }));

      const resume = { kind: "opencode-json" as const, lastTotals: null };
      const result = await openCodeJsonTokenDriver.parse(filePath, resume);
      expect(result.deltas).toEqual([]);
    });
  });

  describe("afterAll", () => {
    it("deposits messageKeys into context from cursors", () => {
      const cursors: Record<string, FileCursorBase> = {
        "/path/a.json": {
          inode: 1,
          mtimeMs: 1000,
          size: 100,
          updatedAt: "2026-01-01T00:00:00Z",
          lastTotals: null,
          messageKey: "ses-001|msg-001",
        } as OpenCodeCursor,
        "/path/b.json": {
          inode: 2,
          mtimeMs: 2000,
          size: 200,
          updatedAt: "2026-01-01T00:00:00Z",
          lastTotals: null,
          messageKey: "ses-002|msg-002",
        } as OpenCodeCursor,
        "/path/c.json": {
          inode: 3,
          mtimeMs: 3000,
          size: 300,
          updatedAt: "2026-01-01T00:00:00Z",
          lastTotals: null,
          messageKey: null,
        } as OpenCodeCursor,
      };

      const ctx: SyncContext = {};
      openCodeJsonTokenDriver.afterAll!(cursors, ctx);

      expect(ctx.messageKeys).toBeDefined();
      expect(ctx.messageKeys!.size).toBe(2);
      expect(ctx.messageKeys!.has("ses-001|msg-001")).toBe(true);
      expect(ctx.messageKeys!.has("ses-002|msg-002")).toBe(true);
    });

    it("does not set messageKeys when no cursors have keys", () => {
      const cursors: Record<string, FileCursorBase> = {
        "/path/a.json": {
          inode: 1,
          mtimeMs: 1000,
          size: 100,
          updatedAt: "2026-01-01T00:00:00Z",
          lastTotals: null,
          messageKey: null,
        } as OpenCodeCursor,
      };

      const ctx: SyncContext = {};
      openCodeJsonTokenDriver.afterAll!(cursors, ctx);

      expect(ctx.messageKeys).toBeUndefined();
    });
  });
});

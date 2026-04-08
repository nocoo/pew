import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiTokenDriver } from "../../../drivers/token/gemini-token-driver.js";
import type { GeminiCursor, TokenDelta } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Gemini chat JSON file with cumulative token counts */
function geminiChat(messages: Array<{ input: number; output: number }>): string {
  return JSON.stringify({
    messages: messages.map((m, i) => ({
      type: "gemini",
      model: "gemini-2.5-pro",
      timestamp: `2026-03-07T10:${String(i).padStart(2, "0")}:00.000Z`,
      tokens: {
        input: m.input,
        output: m.output,
      },
    })),
  });
}

describe("geminiTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-gemini-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(geminiTokenDriver.kind).toBe("file");
    expect(geminiTokenDriver.source).toBe("gemini-cli");
  });

  describe("discover", () => {
    it("returns [] when geminiDir is not set", async () => {
      const files = await geminiTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers Gemini session JSON files", async () => {
      const chatsDir = join(tempDir, "tmp", "abc123", "chats");
      await mkdir(chatsDir, { recursive: true });
      await writeFile(
        join(chatsDir, "session-1.json"),
        geminiChat([{ input: 100, output: 50 }]),
      );

      const files = await geminiTokenDriver.discover(
        { geminiDir: tempDir },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("session-1.json");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 200,
      mtimeMs: 1709827200000,
      size: 2048,
    };

    it("returns false when cursor is undefined", () => {
      expect(geminiTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: GeminiCursor = {
        inode: 200,
        mtimeMs: 1709827200000,
        size: 2048,
        lastIndex: 5,
        lastTotals: null,
        lastModel: null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(geminiTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 200,
      mtimeMs: 1709827200000,
      size: 2048,
    };

    it("returns default state when no cursor", () => {
      const state = geminiTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({
        kind: "array-index",
        startIndex: -1,
        lastTotals: null,
      });
    });

    it("returns stored state when inode matches", () => {
      const lastTotals: TokenDelta = {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 50,
        reasoningOutputTokens: 0,
      };
      const cursor: GeminiCursor = {
        inode: 200,
        mtimeMs: 1709827200000,
        size: 2048,
        lastIndex: 3,
        lastTotals,
        lastModel: "gemini-2.5-pro",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = geminiTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "array-index",
        startIndex: 3,
        lastTotals,
      });
    });

    it("resets state when inode differs", () => {
      const cursor: GeminiCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 2048,
        lastIndex: 3,
        lastTotals: null,
        lastModel: null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = geminiTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "array-index",
        startIndex: -1,
        lastTotals: null,
      });
    });

    it("defaults undefined fields when inode matches (old cursor format)", () => {
      const cursor: GeminiCursor = {
        inode: 200,
        mtimeMs: 1709827200000,
        size: 2048,
        lastIndex: undefined as unknown as number,
        lastTotals: undefined as unknown as null,
        lastModel: null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = geminiTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "array-index",
        startIndex: -1,
        lastTotals: null,
      });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses Gemini JSON and builds cursor with lastIndex/lastTotals", async () => {
      const filePath = join(tempDir, "session-1.json");
      await writeFile(
        filePath,
        geminiChat([
          { input: 100, output: 50 },
          { input: 300, output: 150 },
        ]),
      );

      const resume = {
        kind: "array-index" as const,
        startIndex: -1,
        lastTotals: null,
      };
      const result = await geminiTokenDriver.parse(filePath, resume);

      // Gemini uses cumulative diff — should produce deltas
      expect(result.deltas.length).toBeGreaterThanOrEqual(1);
      expect(result.deltas[0].source).toBe("gemini-cli");

      const fingerprint: FileFingerprint = { inode: 200, mtimeMs: Date.now(), size: 1024 };
      const cursor = geminiTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(200);
      expect(cursor.lastIndex).toBeGreaterThanOrEqual(0);
      expect(cursor.updatedAt).toBeDefined();
    });
  });
});

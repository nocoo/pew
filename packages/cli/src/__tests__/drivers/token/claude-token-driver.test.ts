import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeTokenDriver } from "../../../drivers/token/claude-token-driver.js";
import type { ByteOffsetCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Claude-style JSONL line */
function claudeLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-03-07T10:15:30.000Z",
    message: {
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 5000,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 2000,
        output_tokens: 800,
      },
    },
    ...overrides,
  });
}

describe("claudeTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-claude-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(claudeTokenDriver.kind).toBe("file");
    expect(claudeTokenDriver.source).toBe("claude-code");
  });

  describe("discover", () => {
    it("returns [] when claudeDir is not set", async () => {
      const files = await claudeTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under claudeDir", async () => {
      const projectsDir = join(tempDir, "projects", "proj1");
      await mkdir(projectsDir, { recursive: true });
      await writeFile(join(projectsDir, "session.jsonl"), claudeLine() + "\n");
      await writeFile(join(projectsDir, "not-jsonl.txt"), "ignore");

      const files = await claudeTokenDriver.discover(
        { claudeDir: tempDir },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("session.jsonl");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns false when cursor is undefined", () => {
      expect(claudeTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(claudeTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when mtimeMs differs", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827100000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(claudeTokenDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns offset 0 when no cursor", () => {
      const state = claudeTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });

    it("returns stored offset when inode matches", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = claudeTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 500 });
    });

    it("resets offset to 0 when inode differs", () => {
      const cursor: ByteOffsetCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = claudeTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });

    it("defaults offset to 0 when cursor.offset is undefined (old cursor format)", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: undefined as unknown as number,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = claudeTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses JSONL and builds cursor with endOffset", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const content = claudeLine() + "\n";
      await writeFile(filePath, content);

      const resume = { kind: "byte-offset" as const, startOffset: 0 };
      const result = await claudeTokenDriver.parse(filePath, resume);

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].source).toBe("claude-code");
      expect(result.deltas[0].tokens.inputTokens).toBe(5100);
      expect(result.deltas[0].tokens.outputTokens).toBe(800);

      const fingerprint: FileFingerprint = {
        inode: 100,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = claudeTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(100);
      expect(cursor.offset).toBeGreaterThan(0);
      expect(cursor.updatedAt).toBeDefined();
    });

    it("resumes parsing from byte offset", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const line1 = claudeLine({ timestamp: "2026-03-07T10:00:00.000Z" });
      const line2 = claudeLine({ timestamp: "2026-03-07T10:30:00.000Z" });
      await writeFile(filePath, line1 + "\n" + line2 + "\n");

      // Parse from start
      const result1 = await claudeTokenDriver.parse(filePath, {
        kind: "byte-offset",
        startOffset: 0,
      });
      expect(result1.deltas).toHaveLength(2);

      // Build cursor with endOffset
      const endOffset = (result1 as unknown as { endOffset: number }).endOffset;

      // Parse from offset — nothing new
      const result2 = await claudeTokenDriver.parse(filePath, {
        kind: "byte-offset",
        startOffset: endOffset,
      });
      expect(result2.deltas).toHaveLength(0);
    });
  });
});

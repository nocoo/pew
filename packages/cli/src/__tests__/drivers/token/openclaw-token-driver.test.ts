import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openClawTokenDriver } from "../../../drivers/token/openclaw-token-driver.js";
import type { ByteOffsetCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create an OpenClaw JSONL message line */
function openClawLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-03-07T10:15:30.000Z",
    message: {
      model: "claude-sonnet-4-20250514",
      role: "assistant",
      usage: {
        input: 3000,
        output: 600,
        cacheRead: 500,
        cacheWrite: 100,
        totalTokens: 4200,
      },
    },
    ...overrides,
  });
}

describe("openClawTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-openclaw-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(openClawTokenDriver.kind).toBe("file");
    expect(openClawTokenDriver.source).toBe("openclaw");
  });

  describe("discover", () => {
    it("returns [] when openclawDir is not set", async () => {
      const files = await openClawTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under openclawDir", async () => {
      const sessionsDir = join(tempDir, "agents", "agent1", "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, "session.jsonl"), openClawLine() + "\n");

      const files = await openClawTokenDriver.discover(
        { openclawDir: tempDir },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("session.jsonl");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 400,
      mtimeMs: 1709827200000,
      size: 1024,
    };

    it("returns false when cursor is undefined", () => {
      expect(openClawTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: ByteOffsetCursor = {
        inode: 400,
        mtimeMs: 1709827200000,
        size: 1024,
        offset: 200,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(openClawTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 400,
      mtimeMs: 1709827200000,
      size: 1024,
    };

    it("returns offset 0 when no cursor", () => {
      const state = openClawTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });

    it("returns stored offset when inode matches", () => {
      const cursor: ByteOffsetCursor = {
        inode: 400,
        mtimeMs: 1709827200000,
        size: 1024,
        offset: 200,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = openClawTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 200 });
    });

    it("defaults offset to 0 when cursor.offset is undefined", () => {
      const cursor: ByteOffsetCursor = {
        inode: 400,
        mtimeMs: 1709827200000,
        size: 1024,
        offset: undefined as unknown as number,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = openClawTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });

    it("resets offset when inode differs", () => {
      const cursor: ByteOffsetCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 1024,
        offset: 200,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = openClawTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses OpenClaw JSONL and builds cursor with endOffset", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const content = openClawLine() + "\n";
      await writeFile(filePath, content);

      const resume = { kind: "byte-offset" as const, startOffset: 0 };
      const result = await openClawTokenDriver.parse(filePath, resume);

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].source).toBe("openclaw");

      const fingerprint: FileFingerprint = {
        inode: 400,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = openClawTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(400);
      expect(cursor.offset).toBeGreaterThan(0);
      expect(cursor.updatedAt).toBeDefined();
    });
  });
});

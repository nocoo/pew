import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piTokenDriver } from "../../../drivers/token/pi-token-driver.js";
import type { ByteOffsetCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Pi assistant message JSONL line with usage */
function piAssistantLine(opts: {
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
} = {}): string {
  const {
    model = "claude-sonnet-4-20250514",
    input = 1000,
    output = 200,
    cacheRead = 100,
    cacheWrite = 50,
  } = opts;
  return JSON.stringify({
    type: "message",
    timestamp: "2026-04-01T10:00:00.000Z",
    message: {
      role: "assistant",
      model,
      usage: { input, output, cacheRead, cacheWrite },
    },
  });
}

/** Helper: create a Pi session header line */
function piSessionLine(): string {
  return JSON.stringify({
    type: "session",
    id: "sess-001",
    timestamp: "2026-04-01T09:59:00.000Z",
    cwd: "/tmp/project",
  });
}

describe("piTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-pi-token-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(piTokenDriver.kind).toBe("file");
    expect(piTokenDriver.source).toBe("pi");
  });

  describe("discover", () => {
    it("returns [] when piSessionsDir is not set", async () => {
      const files = await piTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under piSessionsDir", async () => {
      const sessDir = join(tempDir, "--Users-test-project--");
      await mkdir(sessDir, { recursive: true });
      await writeFile(
        join(sessDir, "session.jsonl"),
        piSessionLine() + "\n" + piAssistantLine() + "\n",
      );

      const files = await piTokenDriver.discover(
        { piSessionsDir: tempDir },
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
      expect(piTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(piTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when mtimeMs differs", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827100000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(piTokenDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns startOffset=0 when no cursor", () => {
      const state = piTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });

    it("returns persisted offset when inode matches", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = piTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 500 });
    });

    it("resets offset when inode differs", () => {
      const cursor: ByteOffsetCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = piTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });

    it("defaults undefined offset to 0 when inode matches", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: undefined as unknown as number,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = piTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses Pi JSONL and builds cursor", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const content =
        piSessionLine() + "\n" +
        piAssistantLine({ input: 1000, output: 200, cacheRead: 100, cacheWrite: 50 }) + "\n";
      await writeFile(filePath, content);

      const resume = { kind: "byte-offset" as const, startOffset: 0 };
      const result = await piTokenDriver.parse(filePath, resume);

      expect(result.deltas.length).toBeGreaterThanOrEqual(1);
      expect(result.endOffset).toBeGreaterThan(0);

      const fingerprint: FileFingerprint = {
        inode: 100,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = piTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(100);
      expect(cursor.offset).toBe(result.endOffset);
      expect(cursor.updatedAt).toBeDefined();
    });

    it("resumes from offset and emits no duplicates", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const content =
        piSessionLine() + "\n" +
        piAssistantLine() + "\n";
      await writeFile(filePath, content);

      // First parse
      const result1 = await piTokenDriver.parse(filePath, {
        kind: "byte-offset",
        startOffset: 0,
      });
      expect(result1.deltas.length).toBeGreaterThanOrEqual(1);

      // Resume from end — no new data
      const result2 = await piTokenDriver.parse(filePath, {
        kind: "byte-offset",
        startOffset: result1.endOffset,
      });
      expect(result2.deltas).toHaveLength(0);
    });
  });
});

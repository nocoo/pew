import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copilotCliTokenDriver } from "../../../drivers/token/copilot-cli-token-driver.js";
import type { ByteOffsetCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

function buildUsageBlock(input_tokens = 1000, output_tokens = 100): string {
  return [
    `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
    `{`,
    `  "kind": "assistant_usage",`,
    `  "properties": { "model": "claude-opus-4.6" },`,
    `  "metrics": {`,
    `    "input_tokens": ${input_tokens},`,
    `    "output_tokens": ${output_tokens},`,
    `    "cache_read_tokens": 0,`,
    `    "cache_write_tokens": 0`,
    `  },`,
    `  "created_at": "2026-03-16T10:40:00.959Z"`,
    `}`,
    `2026-03-16T10:40:00.960Z [DEBUG] Done`,
  ].join("\n") + "\n";
}

describe("copilotCliTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-copilot-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(copilotCliTokenDriver.kind).toBe("file");
    expect(copilotCliTokenDriver.source).toBe("copilot-cli");
  });

  describe("discover", () => {
    it("returns [] when copilotCliLogsDir is not set", async () => {
      const files = await copilotCliTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers process-*.log files under copilotCliLogsDir", async () => {
      await writeFile(join(tempDir, "process-123-456.log"), buildUsageBlock());
      await writeFile(join(tempDir, "process-789-012.log"), buildUsageBlock());
      await writeFile(join(tempDir, "other.txt"), "ignore");

      const files = await copilotCliTokenDriver.discover(
        { copilotCliLogsDir: tempDir },
        ctx,
      );
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.endsWith(".log"))).toBe(true);
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns false when cursor is undefined", () => {
      expect(copilotCliTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(copilotCliTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when size differs", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(copilotCliTokenDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns offset 0 when no cursor", () => {
      const state = copilotCliTokenDriver.resumeState(undefined, fingerprint);
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
      const state = copilotCliTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 500 });
    });

    it("defaults offset to 0 when cursor.offset is undefined", () => {
      const cursor: ByteOffsetCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: undefined as unknown as number,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = copilotCliTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });

    it("resets offset to 0 when inode differs", () => {
      const cursor: ByteOffsetCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = copilotCliTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "byte-offset", startOffset: 0 });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses log file and builds cursor with endOffset", async () => {
      const filePath = join(tempDir, "process-123.log");
      const content = buildUsageBlock(5000, 800);
      await writeFile(filePath, content);

      const resume = { kind: "byte-offset" as const, startOffset: 0 };
      const result = await copilotCliTokenDriver.parse(filePath, resume);

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0]!.source).toBe("copilot-cli");
      expect(result.deltas[0]!.tokens.inputTokens).toBe(5000);
      expect(result.deltas[0]!.tokens.outputTokens).toBe(800);

      const fingerprint: FileFingerprint = {
        inode: 100,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = copilotCliTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(100);
      expect(cursor.offset).toBeGreaterThan(0);
      expect(cursor.updatedAt).toBeDefined();
    });

    it("resumes parsing from byte offset", async () => {
      const filePath = join(tempDir, "process-resume.log");
      const block1 = buildUsageBlock(1000, 100);
      await writeFile(filePath, block1);

      const r1 = await copilotCliTokenDriver.parse(filePath, {
        kind: "byte-offset",
        startOffset: 0,
      });
      expect(r1.deltas).toHaveLength(1);

      const endOffset = (r1 as unknown as { endOffset: number }).endOffset;

      const block2 = buildUsageBlock(2000, 200);
      await writeFile(filePath, block1 + block2);

      const r2 = await copilotCliTokenDriver.parse(filePath, {
        kind: "byte-offset",
        startOffset: endOffset,
      });
      expect(r2.deltas).toHaveLength(1);
      expect(r2.deltas[0]!.tokens.inputTokens).toBe(2000);
    });
  });
});

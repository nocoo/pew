import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ompTokenDriver } from "../../../drivers/token/omp-token-driver.js";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** omp writes the pi schema: session header + assistant messages with usage */
const SESSION_LINE = JSON.stringify({
  type: "session",
  version: 3,
  id: "019fc4c0-9097-7000-868a-7b93e2205b9b",
  timestamp: "2026-08-02T23:13:02.103Z",
  cwd: "/tmp/project",
});

const ASSISTANT_LINE = JSON.stringify({
  type: "message",
  timestamp: "2026-08-02T23:13:31.892Z",
  message: {
    role: "assistant",
    model: "claude-opus-5",
    usage: { input: 44128, output: 195, cacheRead: 0, cacheWrite: 0, totalTokens: 44323 },
  },
});

describe("ompTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-omp-token-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(ompTokenDriver.kind).toBe("file");
    expect(ompTokenDriver.source).toBe("omp");
  });

  describe("discover", () => {
    it("returns [] when ompSessionsDir is not set", async () => {
      expect(await ompTokenDriver.discover({}, ctx)).toEqual([]);
    });

    it("ignores piSessionsDir — omp reads its own root only", async () => {
      const sessDir = join(tempDir, "-workspace-project");
      await mkdir(sessDir, { recursive: true });
      await writeFile(join(sessDir, "session.jsonl"), `${SESSION_LINE}\n`);

      expect(await ompTokenDriver.discover({ piSessionsDir: tempDir }, ctx)).toEqual([]);
    });

    it("discovers JSONL files under ompSessionsDir", async () => {
      const sessDir = join(tempDir, "-workspace-project");
      await mkdir(sessDir, { recursive: true });
      await writeFile(
        join(sessDir, "session.jsonl"),
        `${SESSION_LINE}\n${ASSISTANT_LINE}\n`,
      );

      const files = await ompTokenDriver.discover({ ompSessionsDir: tempDir }, ctx);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("session.jsonl");
    });
  });

  describe("parse + buildCursor", () => {
    it("tags deltas as omp and resumes from the byte offset", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const content = `${SESSION_LINE}\n${ASSISTANT_LINE}\n`;
      await writeFile(filePath, content);

      const result = await ompTokenDriver.parse(
        filePath,
        { kind: "byte-offset", startOffset: 0 },
        ctx,
      );
      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].source).toBe("omp");
      expect(result.deltas[0].tokens).toEqual({
        inputTokens: 44128,
        cachedInputTokens: 0,
        outputTokens: 195,
        reasoningOutputTokens: 0,
      });

      const fingerprint: FileFingerprint = {
        inode: 100,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = ompTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.offset).toBe(result.endOffset);

      const resumed = await ompTokenDriver.parse(
        filePath,
        { kind: "byte-offset", startOffset: result.endOffset },
        ctx,
      );
      expect(resumed.deltas).toHaveLength(0);
    });
  });
});

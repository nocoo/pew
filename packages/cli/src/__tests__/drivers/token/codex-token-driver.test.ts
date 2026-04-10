import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexTokenDriver } from "../../../drivers/token/codex-token-driver.js";
import type { CodexCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Codex JSONL token_count event line */
function codexTokenLine(opts: {
  input?: number;
  output?: number;
  model?: string;
  timestamp?: string;
} = {}): string {
  const {
    input = 1000,
    output = 200,
    model = "o3-mini",
    timestamp = "2026-03-07T10:15:30.000Z",
  } = opts;
  return JSON.stringify({
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          output_tokens: output,
          input_tokens_cache_hit: 0,
          reasoning_tokens: 50,
        },
      },
    },
  });
}

/** Helper: create a Codex session_meta line with model */
function codexSessionMeta(model: string = "o3-mini"): string {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-03-07T10:00:00.000Z",
    payload: { model },
  });
}

describe("codexTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-codex-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(codexTokenDriver.kind).toBe("file");
    expect(codexTokenDriver.source).toBe("codex");
  });

  describe("discover", () => {
    it("returns [] when codexSessionsDir is not set", async () => {
      const files = await codexTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers JSONL rollout files under codexSessionsDir", async () => {
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      await writeFile(
        join(dayDir, "rollout-abc123.jsonl"),
        codexSessionMeta() + "\n" + codexTokenLine() + "\n",
      );

      const files = await codexTokenDriver.discover(
        { codexSessionsDir: tempDir },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("rollout-abc123.jsonl");
    });

    it("discovers files from both codexSessionsDir and multicaCodexDirs", async () => {
      // Primary dir
      const primaryDir = join(tempDir, "primary", "2026", "03", "07");
      await mkdir(primaryDir, { recursive: true });
      await writeFile(
        join(primaryDir, "rollout-primary.jsonl"),
        codexSessionMeta() + "\n" + codexTokenLine() + "\n",
      );

      // Multica extra dirs
      const multicaDir1 = join(tempDir, "multica", "ws1", "task1", "sessions");
      const multicaDir2 = join(tempDir, "multica", "ws2", "task2", "sessions");
      await mkdir(multicaDir1, { recursive: true });
      await mkdir(multicaDir2, { recursive: true });
      await writeFile(
        join(multicaDir1, "rollout-multica1.jsonl"),
        codexSessionMeta() + "\n" + codexTokenLine() + "\n",
      );
      await writeFile(
        join(multicaDir2, "rollout-multica2.jsonl"),
        codexSessionMeta() + "\n" + codexTokenLine() + "\n",
      );

      const files = await codexTokenDriver.discover(
        {
          codexSessionsDir: join(tempDir, "primary"),
          multicaCodexDirs: [multicaDir1, multicaDir2],
        },
        ctx,
      );
      expect(files).toHaveLength(3);
      expect(files.some((f) => f.includes("rollout-primary.jsonl"))).toBe(true);
      expect(files.some((f) => f.includes("rollout-multica1.jsonl"))).toBe(true);
      expect(files.some((f) => f.includes("rollout-multica2.jsonl"))).toBe(true);
    });

    it("works with empty multicaCodexDirs array", async () => {
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      await writeFile(
        join(dayDir, "rollout-abc123.jsonl"),
        codexSessionMeta() + "\n" + codexTokenLine() + "\n",
      );

      const files = await codexTokenDriver.discover(
        { codexSessionsDir: tempDir, multicaCodexDirs: [] },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("rollout-abc123.jsonl");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 500,
      mtimeMs: 1709827200000,
      size: 2048,
    };

    it("returns false when cursor is undefined", () => {
      expect(codexTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: CodexCursor = {
        inode: 500,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 300,
        lastTotals: null,
        lastModel: null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(codexTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 500,
      mtimeMs: 1709827200000,
      size: 2048,
    };

    it("returns default state when no cursor", () => {
      const state = codexTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      });
    });

    it("returns stored state when inode matches", () => {
      const lastTotals = {
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 200,
        reasoningOutputTokens: 50,
      };
      const cursor: CodexCursor = {
        inode: 500,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 300,
        lastTotals,
        lastModel: "o3-mini",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = codexTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 300,
        lastTotals,
        lastModel: "o3-mini",
      });
    });

    it("defaults undefined fields to null/0 when inode matches (old cursor)", () => {
      const cursor: CodexCursor = {
        inode: 500,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: undefined as unknown as number,
        lastTotals: undefined as unknown as null,
        lastModel: undefined as unknown as null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = codexTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      });
    });

    it("resets state when inode differs", () => {
      const cursor: CodexCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 300,
        lastTotals: null,
        lastModel: "o3-mini",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = codexTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses Codex JSONL and builds cursor with endOffset + lastTotals", async () => {
      const filePath = join(tempDir, "rollout-abc.jsonl");
      const content =
        codexSessionMeta("o3-mini") + "\n" + codexTokenLine({ input: 1000, output: 200 }) + "\n";
      await writeFile(filePath, content);

      const resume = {
        kind: "codex" as const,
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      };
      const result = await codexTokenDriver.parse(filePath, resume);

      // Codex uses cumulative diff — first absolute totals produce a delta
      expect(result.deltas.length).toBeGreaterThanOrEqual(1);
      if (result.deltas.length > 0) {
        expect(result.deltas[0].source).toBe("codex");
      }

      const fingerprint: FileFingerprint = {
        inode: 500,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = codexTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(500);
      expect(cursor.offset).toBeGreaterThan(0);
      expect(cursor.updatedAt).toBeDefined();
    });
  });
});

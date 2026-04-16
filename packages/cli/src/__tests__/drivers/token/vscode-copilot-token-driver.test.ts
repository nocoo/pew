import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vscodeCopilotTokenDriver } from "../../../drivers/token/vscode-copilot-token-driver.js";
import type { VscodeCopilotCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a kind=2 append (new request) line */
function appendRequestLine(modelId: string, timestamp: number): string {
  return JSON.stringify({
    kind: 2,
    k: ["requests"],
    v: [{ modelId, timestamp, message: { text: "Hello" } }],
  });
}

/** Helper: create a kind=1 set result line */
function resultLine(requestIndex: number, promptTokens: number, outputTokens: number): string {
  return JSON.stringify({
    kind: 1,
    k: ["requests", requestIndex, "result"],
    v: {
      metadata: { promptTokens, outputTokens },
      value: "some response",
    },
  });
}

describe("vscodeCopilotTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-vsc-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(vscodeCopilotTokenDriver.kind).toBe("file");
    expect(vscodeCopilotTokenDriver.source).toBe("vscode-copilot");
  });

  describe("discover", () => {
    it("returns [] when vscodeCopilotDirs is not set", async () => {
      const files = await vscodeCopilotTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("returns [] when vscodeCopilotDirs is empty", async () => {
      const files = await vscodeCopilotTokenDriver.discover(
        { vscodeCopilotDirs: [] },
        ctx,
      );
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under vscodeCopilotDirs", async () => {
      const wsDir = join(tempDir, "workspaceStorage", "abc123", "chatSessions");
      await mkdir(wsDir, { recursive: true });
      await writeFile(
        join(wsDir, "session.jsonl"),
        appendRequestLine("copilot/gpt-4o", 1709827200000) + "\n",
      );

      const files = await vscodeCopilotTokenDriver.discover(
        { vscodeCopilotDirs: [tempDir] },
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
      expect(vscodeCopilotTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: VscodeCopilotCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        processedRequestIndices: [0],
        requestMeta: { 0: { modelId: "gpt-4o", timestamp: 1709827200000 } },
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(vscodeCopilotTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when mtimeMs differs", () => {
      const cursor: VscodeCopilotCursor = {
        inode: 100,
        mtimeMs: 1709827100000,
        size: 4096,
        offset: 500,
        processedRequestIndices: [],
        requestMeta: {},
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(vscodeCopilotTokenDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns empty state when no cursor", () => {
      const state = vscodeCopilotTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({
        kind: "vscode-copilot",
        startOffset: 0,
        requestMeta: {},
        processedRequestIndices: [],
        processedRequestIds: new Set<string>(),
      });
    });

    it("returns persisted CRDT state when inode matches", () => {
      const meta = { 0: { modelId: "gpt-4o", timestamp: 1709827200000 } };
      const cursor: VscodeCopilotCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        processedRequestIndices: [0],
        requestMeta: meta,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = vscodeCopilotTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "vscode-copilot",
        startOffset: 500,
        requestMeta: meta,
        processedRequestIndices: [0],
        processedRequestIds: new Set<string>(),
      });
    });

    it("resets state when inode differs (file rotated)", () => {
      const cursor: VscodeCopilotCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        processedRequestIndices: [0],
        requestMeta: { 0: { modelId: "gpt-4o", timestamp: 1709827200000 } },
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = vscodeCopilotTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "vscode-copilot",
        startOffset: 0,
        requestMeta: {},
        processedRequestIndices: [],
        processedRequestIds: new Set<string>(),
      });
    });

    it("defaults undefined fields when inode matches (old cursor format)", () => {
      const cursor: VscodeCopilotCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: undefined as unknown as number,
        processedRequestIndices: undefined as unknown as number[],
        requestMeta: undefined as unknown as Record<number, { modelId: string; timestamp: number }>,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = vscodeCopilotTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "vscode-copilot",
        startOffset: 0,
        requestMeta: {},
        processedRequestIndices: [],
        processedRequestIds: new Set<string>(),
      });
    });

    it("restores processedRequestIds from cursor when inode matches", () => {
      const cursor: VscodeCopilotCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        processedRequestIndices: [],
        requestMeta: {},
        processedRequestIds: ["req_1", "req_2"],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = vscodeCopilotTokenDriver.resumeState(cursor, fingerprint);
      expect(state.processedRequestIds).toEqual(new Set(["req_1", "req_2"]));
    });
  });

  describe("parse + buildCursor", () => {
    it("parses CRDT JSONL and builds cursor with full state", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const content =
        appendRequestLine("copilot/gpt-4o", 1709827200000) + "\n" +
        resultLine(0, 500, 200) + "\n";
      await writeFile(filePath, content);

      const resume = {
        kind: "vscode-copilot" as const,
        startOffset: 0,
        requestMeta: {},
        processedRequestIndices: [],
      };
      const result = await vscodeCopilotTokenDriver.parse(filePath, resume);

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].source).toBe("vscode-copilot");
      expect(result.deltas[0].model).toBe("gpt-4o");
      expect(result.deltas[0].tokens.inputTokens).toBe(500);
      expect(result.deltas[0].tokens.outputTokens).toBe(200);
      expect(result.deltas[0].tokens.cachedInputTokens).toBe(0);
      expect(result.deltas[0].tokens.reasoningOutputTokens).toBe(0);

      const fingerprint: FileFingerprint = {
        inode: 100,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = vscodeCopilotTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(100);
      expect(cursor.offset).toBeGreaterThan(0);
      expect(cursor.processedRequestIndices).toEqual([0]);
      expect(cursor.requestMeta).toHaveProperty("0");
      expect(cursor.requestMeta[0].modelId).toBe("gpt-4o");
      expect(cursor.updatedAt).toBeDefined();
    });

    it("resumes parsing from byte offset with persisted metadata", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const line1 = appendRequestLine("copilot/gpt-4o", 1709827200000);
      const line2 = resultLine(0, 500, 200);
      const firstChunk = line1 + "\n" + line2 + "\n";

      // Append more data later
      const line3 = appendRequestLine("copilot/claude-opus-4.6", 1709827260000);
      const line4 = resultLine(1, 1000, 400);
      const fullContent = firstChunk + line3 + "\n" + line4 + "\n";
      await writeFile(filePath, fullContent);

      // Parse first chunk
      const result1 = await vscodeCopilotTokenDriver.parse(filePath, {
        kind: "vscode-copilot",
        startOffset: 0,
        requestMeta: {},
        processedRequestIndices: [],
      });
      expect(result1.deltas).toHaveLength(2);

      // Build cursor from first parse
      const fp = { inode: 1, mtimeMs: Date.now(), size: fullContent.length };
      const cursor = vscodeCopilotTokenDriver.buildCursor(fp, result1);

      // Resume from cursor — should have no new deltas
      const resume2 = vscodeCopilotTokenDriver.resumeState(
        { ...cursor, inode: 1 },
        { inode: 1, mtimeMs: Date.now(), size: fullContent.length },
      );
      const result2 = await vscodeCopilotTokenDriver.parse(filePath, resume2);
      expect(result2.deltas).toHaveLength(0);
    });

    it("parses v3 JSON files and builds cursor with processedRequestIds", async () => {
      const filePath = join(tempDir, "session.json");
      const v3Data = {
        version: 3,
        requests: [
          {
            requestId: "req_001",
            modelId: "copilot/gpt-4o",
            timestamp: 1709827200000,
            message: { text: "Hello" },
            result: {
              metadata: {
                promptTokens: 800,
                outputTokens: 300,
                toolCallRounds: [],
              },
              value: "response",
            },
          },
        ],
      };
      await writeFile(filePath, JSON.stringify(v3Data));

      const resume = {
        kind: "vscode-copilot" as const,
        startOffset: 0,
        requestMeta: {},
        processedRequestIndices: [],
        processedRequestIds: new Set<string>(),
      };
      const result = await vscodeCopilotTokenDriver.parse(filePath, resume);

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].source).toBe("vscode-copilot");
      expect(result.deltas[0].model).toBe("gpt-4o");
      expect(result.deltas[0].tokens.inputTokens).toBe(800);
      expect(result.deltas[0].tokens.outputTokens).toBe(300);

      // v3 parse result carries processedRequestIds instead of CRDT state
      expect(result.processedRequestIds).toContain("req_001");
      expect(result.endOffset).toBe(0); // v3 doesn't use byte offset
      expect(result.requestMeta).toEqual({});
      expect(result.processedRequestIndices).toEqual([]);

      // Build cursor from v3 result
      const fingerprint: FileFingerprint = {
        inode: 200,
        mtimeMs: Date.now(),
        size: 1024,
      };
      const cursor = vscodeCopilotTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(200);
      expect(cursor.processedRequestIds).toContain("req_001");
      expect(cursor.offset).toBe(0);
    });
  });
});

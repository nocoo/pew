import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kosmosTokenDriver } from "../../../drivers/token/kosmos-token-driver.js";
import type { KosmosCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a minimal Kosmos chat session JSON */
function kosmosSession(opts: {
  messages?: Array<{
    id?: string;
    role?: string;
    model?: string;
    timestamp?: number;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>;
}): string {
  const messages = (opts.messages ?? []).map((m, i) => ({
    id: m.id ?? `msg-${i}`,
    role: m.role ?? "assistant",
    model: m.model ?? "gpt-4o",
    timestamp: m.timestamp ?? 1700000000000 + i * 1000,
    usage: m.usage ?? { prompt_tokens: 100, completion_tokens: 50 },
  }));

  return JSON.stringify({
    chatSession_id: "ses-001",
    chat_history: messages,
  });
}

describe("kosmosTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-kosmos-token-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(kosmosTokenDriver.kind).toBe("file");
    expect(kosmosTokenDriver.source).toBe("kosmos");
  });

  describe("discover", () => {
    it("returns [] when kosmosDataDirs is not set", async () => {
      const files = await kosmosTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("returns [] when kosmosDataDirs is empty", async () => {
      const files = await kosmosTokenDriver.discover({ kosmosDataDirs: [] }, ctx);
      expect(files).toEqual([]);
    });

    it("discovers chatSession_*.json files under dataDirs", async () => {
      const dataDir = join(tempDir, "kosmos-app");
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, "chatSession_001.json"), kosmosSession({}));

      const files = await kosmosTokenDriver.discover({ kosmosDataDirs: [dataDir] }, ctx);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("chatSession_001.json");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 400,
      mtimeMs: 1709827200000,
      size: 1024,
    };

    it("returns false when cursor is undefined", () => {
      expect(kosmosTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: KosmosCursor = {
        inode: 400,
        mtimeMs: 1709827200000,
        size: 1024,
        processedMessageIds: [],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(kosmosTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 400,
      mtimeMs: 1709827200000,
      size: 1024,
    };

    it("returns null knownMessageIds when no cursor", () => {
      const state = kosmosTokenDriver.resumeState(undefined, fingerprint);
      expect(state.kind).toBe("kosmos");
      expect(state.knownMessageIds).toBeNull();
    });

    it("returns Set from cursor processedMessageIds", () => {
      const cursor: KosmosCursor = {
        inode: 400,
        mtimeMs: 1709827200000,
        size: 1024,
        processedMessageIds: ["msg-1", "msg-2"],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = kosmosTokenDriver.resumeState(cursor, fingerprint);
      expect(state.kind).toBe("kosmos");
      expect(state.knownMessageIds).toBeInstanceOf(Set);
      expect(state.knownMessageIds!.has("msg-1")).toBe(true);
      expect(state.knownMessageIds!.has("msg-2")).toBe(true);
    });
  });

  describe("parse + buildCursor", () => {
    it("parses Kosmos JSON and builds cursor with processedMessageIds", async () => {
      const filePath = join(tempDir, "chatSession_001.json");
      const content = kosmosSession({
        messages: [
          { id: "msg-1", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 100, completion_tokens: 50 } },
        ],
      });
      await writeFile(filePath, content);

      const resume = { kind: "kosmos" as const, knownMessageIds: null };
      const result = await kosmosTokenDriver.parse(filePath, resume);

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].source).toBe("kosmos");

      const fingerprint: FileFingerprint = {
        inode: 400,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = kosmosTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(400);
      expect(cursor.processedMessageIds).toContain("msg-1");
      expect(cursor.updatedAt).toBeDefined();
    });

    it("accumulates processedMessageIds across cursors", async () => {
      const fingerprint: FileFingerprint = { inode: 400, mtimeMs: Date.now(), size: 100 };
      const prev: KosmosCursor = {
        inode: 400,
        mtimeMs: Date.now() - 1000,
        size: 50,
        processedMessageIds: ["msg-old"],
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const filePath = join(tempDir, "chatSession_002.json");
      await writeFile(filePath, kosmosSession({
        messages: [
          { id: "msg-new", role: "assistant", model: "gpt-4o", timestamp: 1700000000000, usage: { prompt_tokens: 100, completion_tokens: 50 } },
        ],
      }));

      const resume = { kind: "kosmos" as const, knownMessageIds: new Set(prev.processedMessageIds) };
      const result = await kosmosTokenDriver.parse(filePath, resume);
      const cursor = kosmosTokenDriver.buildCursor(fingerprint, result, prev);

      expect(cursor.processedMessageIds).toContain("msg-old");
      expect(cursor.processedMessageIds).toContain("msg-new");
    });
  });
});

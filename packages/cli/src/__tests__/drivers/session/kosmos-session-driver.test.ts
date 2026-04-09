import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kosmosSessionDriver, pmstudioSessionDriver } from "../../../drivers/session/kosmos-session-driver.js";
import type { SessionFileCursor } from "@pew/core";
import type { FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a minimal Kosmos chat session JSON */
function kosmosSession(opts: {
  chatSessionId?: string;
  messages?: Array<{
    role?: string;
    model?: string;
    timestamp?: number;
  }>;
}): string {
  const messages = (opts.messages ?? []).map((m, i) => ({
    id: `msg-${i}`,
    role: m.role ?? "assistant",
    model: m.model ?? "gpt-4o",
    timestamp: m.timestamp ?? 1700000000000 + i * 1000,
  }));

  return JSON.stringify({
    chatSession_id: opts.chatSessionId ?? "ses-001",
    chat_history: messages,
  });
}

describe("kosmosSessionDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-kosmos-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(kosmosSessionDriver.kind).toBe("file");
    expect(kosmosSessionDriver.source).toBe("kosmos");
  });

  describe("discover", () => {
    it("returns [] when kosmosDataDir is not set", async () => {
      const files = await kosmosSessionDriver.discover({});
      expect(files).toEqual([]);
    });

    it("discovers chatSession_*.json files under dataDir", async () => {
      const dataDir = join(tempDir, "kosmos-app");
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, "chatSession_001.json"), kosmosSession({}));

      const files = await kosmosSessionDriver.discover({ kosmosDataDir: dataDir });
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
      expect(kosmosSessionDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when mtime+size match", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 1024 };
      expect(kosmosSessionDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when size differs", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 512 };
      expect(kosmosSessionDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("parse + buildCursor", () => {
    it("parses Kosmos JSON and returns session snapshot", async () => {
      const filePath = join(tempDir, "chatSession_001.json");
      await writeFile(filePath, kosmosSession({
        chatSessionId: "ses-test",
        messages: [
          { role: "user", timestamp: 1700000000000 },
          { role: "assistant", model: "gpt-4o", timestamp: 1700000005000 },
        ],
      }));

      const snapshots = await kosmosSessionDriver.parse(filePath);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].source).toBe("kosmos");
      expect(snapshots[0].kind).toBe("human");
      expect(snapshots[0].sessionKey).toBe("kosmos:ses-test");
    });

    it("buildCursor returns mtime+size from fingerprint", () => {
      const fingerprint: FileFingerprint = { inode: 42, mtimeMs: 1709827200000, size: 256 };
      const cursor = kosmosSessionDriver.buildCursor(fingerprint);
      expect(cursor).toEqual({ mtimeMs: 1709827200000, size: 256 });
    });
  });
});

describe("pmstudioSessionDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-pmstudio-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(pmstudioSessionDriver.kind).toBe("file");
    expect(pmstudioSessionDriver.source).toBe("pmstudio");
  });

  describe("discover", () => {
    it("returns [] when pmstudioDataDir is not set", async () => {
      const files = await pmstudioSessionDriver.discover({});
      expect(files).toEqual([]);
    });

    it("discovers chatSession_*.json files under dataDir", async () => {
      const dataDir = join(tempDir, "pm-studio-app");
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, "chatSession_001.json"), kosmosSession({}));

      const files = await pmstudioSessionDriver.discover({ pmstudioDataDir: dataDir });
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("chatSession_001.json");
    });
  });

  describe("parse", () => {
    it("parses JSON and returns session snapshot with source=pmstudio", async () => {
      const filePath = join(tempDir, "chatSession_001.json");
      await writeFile(filePath, kosmosSession({
        chatSessionId: "ses-pm",
        messages: [
          { role: "user", timestamp: 1700000000000 },
          { role: "assistant", model: "gpt-4o", timestamp: 1700000005000 },
        ],
      }));

      const snapshots = await pmstudioSessionDriver.parse(filePath);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].source).toBe("pmstudio");
      expect(snapshots[0].sessionKey).toBe("pmstudio:ses-pm");
    });
  });
});

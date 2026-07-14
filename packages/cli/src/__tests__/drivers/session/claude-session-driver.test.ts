import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeSessionDriver } from "../../../drivers/session/claude-session-driver.js";
import type { SessionFileCursor } from "@pew/core";
import type { FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Claude-style JSONL line with sessionId */
function claudeSessionLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: "ses-001",
    timestamp: "2026-03-07T10:15:30.000Z",
    type: "user",
    ...overrides,
  });
}

describe("claudeSessionDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-claude-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(claudeSessionDriver.kind).toBe("file");
    expect(claudeSessionDriver.source).toBe("claude-code");
  });

  describe("discover", () => {
    it("returns [] when claudeDir is not set", async () => {
      const files = await claudeSessionDriver.discover({});
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under claudeDir", async () => {
      const projectsDir = join(tempDir, "projects", "proj1");
      await mkdir(projectsDir, { recursive: true });
      await writeFile(join(projectsDir, "session.jsonl"), `${claudeSessionLine()}\n`);
      await writeFile(join(projectsDir, "ignore.txt"), "nope");

      const files = await claudeSessionDriver.discover({ claudeDir: tempDir });
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
      expect(claudeSessionDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when mtime+size match", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 4096 };
      expect(claudeSessionDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when mtimeMs differs", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827100000, size: 4096 };
      expect(claudeSessionDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });

    it("returns false when size differs", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 2048 };
      expect(claudeSessionDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("parse + buildCursor", () => {
    it("parses JSONL and returns session snapshots", async () => {
      const projectsDir = join(tempDir, "projects", "my-project");
      await mkdir(projectsDir, { recursive: true });
      const filePath = join(projectsDir, "session.jsonl");
      const content =
        claudeSessionLine({ sessionId: "ses-001", type: "user" }) + "\n" +
        claudeSessionLine({ sessionId: "ses-001", type: "assistant", message: { model: "claude-sonnet-4-20250514" } }) + "\n";
      await writeFile(filePath, content);

      const snapshots = await claudeSessionDriver.parse(filePath);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].sessionKey).toBe("claude:ses-001");
      expect(snapshots[0].source).toBe("claude-code");
      expect(snapshots[0].kind).toBe("human");
      expect(snapshots[0].userMessages).toBe(1);
      expect(snapshots[0].assistantMessages).toBe(1);
    });

    it("buildCursor returns mtime+size from fingerprint", () => {
      const fingerprint: FileFingerprint = { inode: 42, mtimeMs: 1709827200000, size: 512 };
      const cursor = claudeSessionDriver.buildCursor(fingerprint);
      expect(cursor).toEqual({ mtimeMs: 1709827200000, size: 512 });
    });
  });
});

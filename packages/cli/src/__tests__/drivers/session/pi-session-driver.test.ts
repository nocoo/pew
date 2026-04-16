import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piSessionDriver } from "../../../drivers/session/pi-session-driver.js";
import type { SessionFileCursor } from "@pew/core";
import type { FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Pi session header line */
function piSessionLine(id = "sess-001", cwd = "/tmp/project"): string {
  return JSON.stringify({
    type: "session",
    id,
    timestamp: "2026-04-01T09:59:00.000Z",
    cwd,
  });
}

/** Helper: create a Pi assistant message line */
function piAssistantLine(model = "claude-sonnet-4-20250514"): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-04-01T10:00:00.000Z",
    message: {
      role: "assistant",
      model,
      usage: { input: 1000, output: 200, cacheRead: 100, cacheWrite: 50 },
    },
  });
}

describe("piSessionDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-pi-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(piSessionDriver.kind).toBe("file");
    expect(piSessionDriver.source).toBe("pi");
  });

  describe("discover", () => {
    it("returns [] when piSessionsDir is not set", async () => {
      const files = await piSessionDriver.discover({});
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under piSessionsDir", async () => {
      const sessDir = join(tempDir, "--Users-test-project--");
      await mkdir(sessDir, { recursive: true });
      await writeFile(
        join(sessDir, "session.jsonl"),
        piSessionLine() + "\n" + piAssistantLine() + "\n",
      );

      const files = await piSessionDriver.discover({ piSessionsDir: tempDir });
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
      expect(piSessionDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when mtime and size match", () => {
      const cursor: SessionFileCursor = {
        mtimeMs: 1709827200000,
        size: 4096,
      };
      expect(piSessionDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when mtimeMs differs", () => {
      const cursor: SessionFileCursor = {
        mtimeMs: 1709827100000,
        size: 4096,
      };
      expect(piSessionDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });

    it("returns false when size differs", () => {
      const cursor: SessionFileCursor = {
        mtimeMs: 1709827200000,
        size: 8192,
      };
      expect(piSessionDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("parse", () => {
    it("parses Pi session file and returns snapshots", async () => {
      const sessDir = join(tempDir, "--Users-test-project--");
      await mkdir(sessDir, { recursive: true });
      const filePath = join(sessDir, "session.jsonl");
      await writeFile(
        filePath,
        piSessionLine() + "\n" + piAssistantLine() + "\n",
      );

      const result = await piSessionDriver.parse(filePath);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].source).toBe("pi");
    });
  });

  describe("buildCursor", () => {
    it("builds cursor from fingerprint", () => {
      const fingerprint: FileFingerprint = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
      };
      const cursor = piSessionDriver.buildCursor(fingerprint);
      expect(cursor).toEqual({ mtimeMs: 1709827200000, size: 4096 });
    });
  });
});

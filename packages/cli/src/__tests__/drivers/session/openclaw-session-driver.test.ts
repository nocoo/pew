import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openClawSessionDriver } from "../../../drivers/session/openclaw-session-driver.js";
import type { SessionFileCursor } from "@pew/core";
import type { FileFingerprint } from "../../../drivers/types.js";

/** Helper: create an OpenClaw JSONL line */
function openClawLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2026-03-07T10:00:00.000Z",
    type: "message",
    message: { model: "gpt-4o" },
    ...overrides,
  });
}

describe("openClawSessionDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-openclaw-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(openClawSessionDriver.kind).toBe("file");
    expect(openClawSessionDriver.source).toBe("openclaw");
  });

  describe("discover", () => {
    it("returns [] when openclawDir is not set", async () => {
      const files = await openClawSessionDriver.discover({});
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under openclawDir", async () => {
      const sessionsDir = join(tempDir, "agents", "my-agent", "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, "session.jsonl"), `${openClawLine()}\n`);

      const files = await openClawSessionDriver.discover({ openclawDir: tempDir });
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
      expect(openClawSessionDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when mtime+size match", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 1024 };
      expect(openClawSessionDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when size differs", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 512 };
      expect(openClawSessionDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("parse + buildCursor", () => {
    it("parses JSONL and returns session snapshot", async () => {
      const sessionsDir = join(tempDir, "agents", "my-agent", "sessions");
      await mkdir(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, "session.jsonl");
      await writeFile(filePath, `${openClawLine()}\n${openClawLine({ timestamp: "2026-03-07T10:05:00.000Z" })}\n`);

      const snapshots = await openClawSessionDriver.parse(filePath);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].source).toBe("openclaw");
      expect(snapshots[0].kind).toBe("automated");
    });

    it("buildCursor returns mtime+size from fingerprint", () => {
      const fingerprint: FileFingerprint = { inode: 42, mtimeMs: 1709827200000, size: 256 };
      const cursor = openClawSessionDriver.buildCursor(fingerprint);
      expect(cursor).toEqual({ mtimeMs: 1709827200000, size: 256 });
    });
  });
});

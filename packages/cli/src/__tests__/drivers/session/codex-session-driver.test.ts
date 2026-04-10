import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexSessionDriver } from "../../../drivers/session/codex-session-driver.js";
import type { SessionFileCursor } from "@pew/core";
import type { FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Codex rollout JSONL line */
function codexLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-03-07T10:00:00.000Z",
    payload: { id: "uuid-001", cwd: "/tmp/my-project" },
    ...overrides,
  });
}

describe("codexSessionDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-codex-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(codexSessionDriver.kind).toBe("file");
    expect(codexSessionDriver.source).toBe("codex");
  });

  describe("discover", () => {
    it("returns [] when codexSessionsDir is not set", async () => {
      const files = await codexSessionDriver.discover({});
      expect(files).toEqual([]);
    });

    it("discovers rollout JSONL files under codexSessionsDir", async () => {
      const dateDir = join(tempDir, "2026", "03", "07");
      await mkdir(dateDir, { recursive: true });
      await writeFile(join(dateDir, "rollout-uuid.jsonl"), codexLine() + "\n");
      await writeFile(join(dateDir, "other-file.txt"), "ignore");

      const files = await codexSessionDriver.discover({ codexSessionsDir: tempDir });
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("rollout-uuid.jsonl");
    });

    it("discovers files from both codexSessionsDir and multicaCodexDirs", async () => {
      // Primary dir
      const primaryDir = join(tempDir, "primary", "2026", "03", "07");
      await mkdir(primaryDir, { recursive: true });
      await writeFile(
        join(primaryDir, "rollout-primary.jsonl"),
        codexLine() + "\n",
      );

      // Multica extra dirs
      const multicaDir1 = join(tempDir, "multica", "ws1", "task1", "sessions");
      const multicaDir2 = join(tempDir, "multica", "ws2", "task2", "sessions");
      await mkdir(multicaDir1, { recursive: true });
      await mkdir(multicaDir2, { recursive: true });
      await writeFile(
        join(multicaDir1, "rollout-multica1.jsonl"),
        codexLine() + "\n",
      );
      await writeFile(
        join(multicaDir2, "rollout-multica2.jsonl"),
        codexLine() + "\n",
      );

      const files = await codexSessionDriver.discover({
        codexSessionsDir: join(tempDir, "primary"),
        multicaCodexDirs: [multicaDir1, multicaDir2],
      });
      expect(files).toHaveLength(3);
      expect(files.some((f) => f.includes("rollout-primary.jsonl"))).toBe(true);
      expect(files.some((f) => f.includes("rollout-multica1.jsonl"))).toBe(true);
      expect(files.some((f) => f.includes("rollout-multica2.jsonl"))).toBe(true);
    });

    it("works with empty multicaCodexDirs array", async () => {
      const dateDir = join(tempDir, "2026", "03", "07");
      await mkdir(dateDir, { recursive: true });
      await writeFile(join(dateDir, "rollout-uuid.jsonl"), codexLine() + "\n");

      const files = await codexSessionDriver.discover({
        codexSessionsDir: tempDir,
        multicaCodexDirs: [],
      });
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("rollout-uuid.jsonl");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 500,
      mtimeMs: 1709827200000,
      size: 3072,
    };

    it("returns false when cursor is undefined", () => {
      expect(codexSessionDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when mtime+size match", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 3072 };
      expect(codexSessionDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when mtimeMs differs", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827100000, size: 3072 };
      expect(codexSessionDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("parse + buildCursor", () => {
    it("parses rollout JSONL and returns session snapshot", async () => {
      const filePath = join(tempDir, "rollout-uuid.jsonl");
      const content =
        codexLine() + "\n" +
        JSON.stringify({ type: "response_item", timestamp: "2026-03-07T10:01:00.000Z", payload: { role: "user" } }) + "\n" +
        JSON.stringify({ type: "response_item", timestamp: "2026-03-07T10:02:00.000Z", payload: { role: "assistant" } }) + "\n";
      await writeFile(filePath, content);

      const snapshots = await codexSessionDriver.parse(filePath);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].source).toBe("codex");
      expect(snapshots[0].kind).toBe("human");
      expect(snapshots[0].sessionKey).toBe("codex:uuid-001");
    });

    it("buildCursor returns mtime+size from fingerprint", () => {
      const fingerprint: FileFingerprint = { inode: 42, mtimeMs: 1709827200000, size: 1024 };
      const cursor = codexSessionDriver.buildCursor(fingerprint);
      expect(cursor).toEqual({ mtimeMs: 1709827200000, size: 1024 });
    });
  });
});

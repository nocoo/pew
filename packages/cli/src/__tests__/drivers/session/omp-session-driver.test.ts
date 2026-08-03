import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ompSessionDriver } from "../../../drivers/session/omp-session-driver.js";
import type { SessionFileCursor } from "@pew/core";
import type { FileFingerprint } from "../../../drivers/types.js";

/** omp writes the pi schema under ~/.omp/agent/sessions/<encoded-cwd>/ */
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
    usage: { input: 44128, output: 195, cacheRead: 0, cacheWrite: 0 },
  },
});

describe("ompSessionDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-omp-session-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(ompSessionDriver.kind).toBe("file");
    expect(ompSessionDriver.source).toBe("omp");
  });

  describe("discover", () => {
    it("returns [] when ompSessionsDir is not set", async () => {
      expect(await ompSessionDriver.discover({})).toEqual([]);
    });

    it("ignores piSessionsDir — omp reads its own root only", async () => {
      const sessDir = join(tempDir, "-workspace-project");
      await mkdir(sessDir, { recursive: true });
      await writeFile(join(sessDir, "session.jsonl"), `${SESSION_LINE}\n`);

      expect(await ompSessionDriver.discover({ piSessionsDir: tempDir })).toEqual([]);
    });

    it("discovers JSONL files under ompSessionsDir", async () => {
      const sessDir = join(tempDir, "-workspace-project");
      await mkdir(sessDir, { recursive: true });
      await writeFile(join(sessDir, "session.jsonl"), `${SESSION_LINE}\n${ASSISTANT_LINE}\n`);

      const files = await ompSessionDriver.discover({ ompSessionsDir: tempDir });
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("session.jsonl");
    });
  });

  describe("shouldSkip + buildCursor", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("never skips a file with no cursor", () => {
      expect(ompSessionDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("skips only when mtime and size both match", () => {
      const cursor: SessionFileCursor = { mtimeMs: 1709827200000, size: 4096 };
      expect(ompSessionDriver.shouldSkip(cursor, fingerprint)).toBe(true);
      expect(ompSessionDriver.shouldSkip({ ...cursor, size: 8192 }, fingerprint)).toBe(false);
      expect(ompSessionDriver.shouldSkip({ ...cursor, mtimeMs: 1 }, fingerprint)).toBe(false);
    });

    it("builds a cursor from the fingerprint", () => {
      expect(ompSessionDriver.buildCursor(fingerprint)).toEqual({
        mtimeMs: 1709827200000,
        size: 4096,
      });
    });
  });

  describe("parse", () => {
    it("tags snapshots and session keys as omp", async () => {
      const sessDir = join(tempDir, "-workspace-project");
      await mkdir(sessDir, { recursive: true });
      const filePath = join(sessDir, "session.jsonl");
      await writeFile(filePath, `${SESSION_LINE}\n${ASSISTANT_LINE}\n`);

      const snapshots = await ompSessionDriver.parse(filePath);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].source).toBe("omp");
      expect(snapshots[0].sessionKey).toBe("omp:019fc4c0-9097-7000-868a-7b93e2205b9b");
    });
  });
});

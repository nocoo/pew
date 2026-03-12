import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeReset } from "../commands/reset.js";

describe("executeReset", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-reset-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should delete all 6 state files when they exist", async () => {
    const files = [
      "cursors.json",
      "queue.jsonl",
      "queue.state.json",
      "session-cursors.json",
      "session-queue.jsonl",
      "session-queue.state.json",
    ];
    for (const f of files) {
      await writeFile(join(tempDir, f), "{}");
    }

    const result = await executeReset({ stateDir: tempDir });

    expect(result.files).toHaveLength(6);
    for (const f of result.files) {
      expect(f.deleted).toBe(true);
    }

    const remaining = await readdir(tempDir);
    expect(remaining).toHaveLength(0);
  });

  it("should skip missing files without error", async () => {
    // Only create 2 of 6 files
    await writeFile(join(tempDir, "cursors.json"), "{}");
    await writeFile(join(tempDir, "queue.jsonl"), "line1\nline2");

    const result = await executeReset({ stateDir: tempDir });

    expect(result.files).toHaveLength(6);

    const deleted = result.files.filter((f) => f.deleted);
    const skipped = result.files.filter((f) => !f.deleted);
    expect(deleted).toHaveLength(2);
    expect(skipped).toHaveLength(4);

    expect(deleted.map((f) => f.file).sort()).toEqual([
      "cursors.json",
      "queue.jsonl",
    ]);
  });

  it("should handle completely empty state dir", async () => {
    const result = await executeReset({ stateDir: tempDir });

    expect(result.files).toHaveLength(6);
    for (const f of result.files) {
      expect(f.deleted).toBe(false);
    }
  });

  it("should not touch unrelated files in state dir", async () => {
    await writeFile(join(tempDir, "config.json"), '{"token":"pk_123"}');
    await writeFile(join(tempDir, "config.dev.json"), '{"token":"pk_dev"}');
    await writeFile(join(tempDir, "cursors.json"), "{}");

    const result = await executeReset({ stateDir: tempDir });

    const deleted = result.files.filter((f) => f.deleted);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].file).toBe("cursors.json");

    // Config files must survive
    const remaining = await readdir(tempDir);
    expect(remaining.sort()).toEqual(["config.dev.json", "config.json"]);
  });

  it("should propagate non-ENOENT errors", async () => {
    const permError = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const unlinkFn = vi.fn().mockRejectedValue(permError);

    await expect(
      executeReset({ stateDir: tempDir, unlinkFn: unlinkFn as any }),
    ).rejects.toThrow("EACCES");
  });

  it("should return correct file names in order", async () => {
    const result = await executeReset({ stateDir: tempDir });

    expect(result.files.map((f) => f.file)).toEqual([
      "cursors.json",
      "queue.jsonl",
      "queue.state.json",
      "session-cursors.json",
      "session-queue.jsonl",
      "session-queue.state.json",
    ]);
  });

  it("should accept custom unlinkFn for DI", async () => {
    const calls: string[] = [];
    const unlinkFn = vi.fn(async (path: string) => {
      calls.push(path);
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      throw err;
    });

    await executeReset({ stateDir: tempDir, unlinkFn: unlinkFn as any });

    expect(calls).toHaveLength(6);
    expect(calls[0]).toBe(join(tempDir, "cursors.json"));
    expect(calls[5]).toBe(join(tempDir, "session-queue.state.json"));
  });
});

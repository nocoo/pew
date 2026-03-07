import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorStore } from "../storage/cursor-store.js";
import type { ByteOffsetCursor, CursorState } from "@zebra/core";

describe("CursorStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-cursor-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty state when no file exists", async () => {
    const store = new CursorStore(tempDir);
    const state = await store.load();
    expect(state.version).toBe(1);
    expect(state.files).toEqual({});
    expect(state.updatedAt).toBeNull();
  });

  it("should save and load cursor state", async () => {
    const store = new CursorStore(tempDir);
    const cursor: ByteOffsetCursor = {
      inode: 123,
      offset: 4096,
      updatedAt: "2026-03-07T10:00:00Z",
    };
    const state: CursorState = {
      version: 1,
      files: { "/path/to/file.jsonl": cursor },
      updatedAt: "2026-03-07T10:00:00Z",
    };
    await store.save(state);
    const loaded = await store.load();
    expect(loaded.files["/path/to/file.jsonl"]).toEqual(cursor);
    expect(loaded.updatedAt).toBe("2026-03-07T10:00:00Z");
  });

  it("should create directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "deep", "nested");
    const store = new CursorStore(nestedDir);
    await store.save({
      version: 1,
      files: {},
      updatedAt: null,
    });
    const loaded = await store.load();
    expect(loaded.version).toBe(1);
  });

  it("should persist valid JSON to disk", async () => {
    const store = new CursorStore(tempDir);
    await store.save({
      version: 1,
      files: { "/test": { inode: 1, offset: 0, updatedAt: "2026-01-01T00:00:00Z" } },
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const raw = await readFile(join(tempDir, "cursors.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.files["/test"].inode).toBe(1);
  });

  it("should handle corrupted file gracefully", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tempDir, "cursors.json"), "corrupted{{{");
    const store = new CursorStore(tempDir);
    const state = await store.load();
    expect(state.version).toBe(1);
    expect(state.files).toEqual({});
  });

  it("should get a specific file cursor", async () => {
    const store = new CursorStore(tempDir);
    const cursor: ByteOffsetCursor = {
      inode: 42,
      offset: 100,
      updatedAt: "2026-03-07T10:00:00Z",
    };
    await store.save({
      version: 1,
      files: { "/my/file": cursor },
      updatedAt: "2026-03-07T10:00:00Z",
    });
    const loaded = await store.load();
    const fileCursor = loaded.files["/my/file"];
    expect(fileCursor).toEqual(cursor);
  });

  it("should return undefined for unknown file cursor", async () => {
    const store = new CursorStore(tempDir);
    const state = await store.load();
    expect(state.files["/nonexistent"]).toBeUndefined();
  });

  it("should expose filePath", () => {
    const store = new CursorStore(tempDir);
    expect(store.filePath).toBe(join(tempDir, "cursors.json"));
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseCursorStore } from "../storage/base-cursor-store.js";

interface TestState {
  version: number;
  data: string;
}

const emptyState = (): TestState => ({ version: 1, data: "" });

describe("BaseCursorStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-base-cursor-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty state when file does not exist", async () => {
    const store = new BaseCursorStore<TestState>(
      join(tempDir, "test.json"),
      emptyState,
    );
    const state = await store.load();
    expect(state).toEqual({ version: 1, data: "" });
  });

  it("should save and load state", async () => {
    const store = new BaseCursorStore<TestState>(
      join(tempDir, "test.json"),
      emptyState,
    );
    await store.save({ version: 1, data: "hello" });
    const loaded = await store.load();
    expect(loaded).toEqual({ version: 1, data: "hello" });
  });

  it("should create nested directories on save", async () => {
    const filePath = join(tempDir, "deep", "nested", "test.json");
    const store = new BaseCursorStore<TestState>(filePath, emptyState);
    await store.save({ version: 1, data: "nested" });
    const loaded = await store.load();
    expect(loaded.data).toBe("nested");
  });

  it("should return empty state on corrupted JSON", async () => {
    const filePath = join(tempDir, "test.json");
    await writeFile(filePath, "{{{corrupted");
    const store = new BaseCursorStore<TestState>(filePath, emptyState);
    const state = await store.load();
    expect(state).toEqual({ version: 1, data: "" });
  });

  it("should expose filePath", () => {
    const filePath = join(tempDir, "test.json");
    const store = new BaseCursorStore<TestState>(filePath, emptyState);
    expect(store.filePath).toBe(filePath);
  });

  it("should write pretty-printed JSON with trailing newline", async () => {
    const filePath = join(tempDir, "test.json");
    const store = new BaseCursorStore<TestState>(filePath, emptyState);
    await store.save({ version: 1, data: "x" });
    const raw = await readFile(filePath, "utf-8");
    expect(raw).toContain("\n");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
  });
});

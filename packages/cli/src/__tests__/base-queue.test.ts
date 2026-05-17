import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseQueue } from "../storage/base-queue.js";

// ---------------------------------------------------------------------------
// Test record type
// ---------------------------------------------------------------------------

interface TestRecord {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueue(dir: string): BaseQueue<TestRecord> {
  return new BaseQueue<TestRecord>(dir, "test.jsonl", "test.state.json");
}

function makeRecord(id: number, name = `item-${id}`): TestRecord {
  return { id, name };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BaseQueue", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-base-queue-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---- append ----

  it("should append a single record to JSONL file", async () => {
    const queue = createQueue(tempDir);
    await queue.append(makeRecord(1));

    const raw = await readFile(join(tempDir, "test.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ id: 1, name: "item-1" });
  });

  it("should append multiple records sequentially", async () => {
    const queue = createQueue(tempDir);
    await queue.append(makeRecord(1));
    await queue.append(makeRecord(2));
    await queue.append(makeRecord(3));

    const raw = await readFile(join(tempDir, "test.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).id).toBe(1);
    expect(JSON.parse(lines[2]).id).toBe(3);
  });

  // ---- appendBatch ----

  it("should appendBatch atomically", async () => {
    const queue = createQueue(tempDir);
    await queue.appendBatch([makeRecord(1), makeRecord(2), makeRecord(3)]);

    const raw = await readFile(join(tempDir, "test.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("should skip appendBatch for empty array", async () => {
    const queue = createQueue(tempDir);
    await queue.appendBatch([]);

    // File should not be created, so readFromOffset returns empty
    const { records, newOffset } = await queue.readFromOffset(0);
    expect(records).toEqual([]);
    expect(newOffset).toBe(0);
  });

  // ---- directory creation ----

  it("should create directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "deep", "nested");
    const queue = new BaseQueue<TestRecord>(
      nestedDir,
      "test.jsonl",
      "test.state.json",
    );
    await queue.append(makeRecord(1));

    const raw = await readFile(join(nestedDir, "test.jsonl"), "utf-8");
    expect(raw.trim().length).toBeGreaterThan(0);
  });

  // ---- readFromOffset ----

  it("should read all records from offset 0", async () => {
    const queue = createQueue(tempDir);
    await queue.appendBatch([makeRecord(1), makeRecord(2)]);

    const { records, newOffset } = await queue.readFromOffset(0);
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe(1);
    expect(records[1].id).toBe(2);
    expect(newOffset).toBeGreaterThan(0);
  });

  it("should read only new records after offset", async () => {
    const queue = createQueue(tempDir);
    await queue.append(makeRecord(1));

    const { newOffset: offset1 } = await queue.readFromOffset(0);

    await queue.append(makeRecord(2));
    const { records, newOffset: offset2 } = await queue.readFromOffset(offset1);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(2);
    expect(offset2).toBeGreaterThan(offset1);
  });

  it("should return empty array when queue file does not exist", async () => {
    const queue = createQueue(tempDir);
    const { records, newOffset } = await queue.readFromOffset(0);
    expect(records).toEqual([]);
    expect(newOffset).toBe(0);
  });

  // ---- BUG FIX: byte vs character offset ----

  it("should handle non-ASCII content correctly (byte offset fix)", async () => {
    const queue = createQueue(tempDir);

    // Record with multi-byte characters (Chinese, emoji)
    const record1 = { id: 1, name: "你好世界" }; // 4 Chinese chars = 12 bytes in UTF-8
    const record2 = { id: 2, name: "hello" };

    await queue.append(record1 as TestRecord);
    const { newOffset: offset1 } = await queue.readFromOffset(0);

    await queue.append(record2 as TestRecord);
    const { records } = await queue.readFromOffset(offset1);

    // With the byte offset fix, this should only return record2
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(2);
    expect(records[0].name).toBe("hello");
  });

  it("should handle emoji in records (multi-byte UTF-8)", async () => {
    const queue = createQueue(tempDir);

    const record1 = { id: 1, name: "🚀🎉" }; // Each emoji is 4 bytes in UTF-8
    const record2 = { id: 2, name: "after-emoji" };

    await queue.append(record1 as TestRecord);
    const { newOffset: offset1 } = await queue.readFromOffset(0);

    await queue.append(record2 as TestRecord);
    const { records } = await queue.readFromOffset(offset1);

    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(2);
  });

  // ---- BUG FIX: corrupted line handling ----

  it("should skip corrupted JSONL lines instead of failing", async () => {
    const queue = createQueue(tempDir);
    const queuePath = join(tempDir, "test.jsonl");

    // Write a mix of valid and corrupt lines manually
    const lines = [
      JSON.stringify(makeRecord(1)),
      "this is not valid json{{{",
      JSON.stringify(makeRecord(3)),
      "",
    ].join("\n");
    await writeFile(queuePath, lines);

    const { records, newOffset } = await queue.readFromOffset(0);

    // Should skip the corrupt line and return the 2 valid records
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe(1);
    expect(records[1].id).toBe(3);
    expect(newOffset).toBeGreaterThan(0);
  });

  it("should return empty records when all lines are corrupted", async () => {
    const queue = createQueue(tempDir);
    const queuePath = join(tempDir, "test.jsonl");

    await writeFile(queuePath, "corrupt1\ncorrupt2\n");

    const { records, newOffset } = await queue.readFromOffset(0);
    expect(records).toEqual([]);
    // newOffset should still advance past the corrupted data
    expect(newOffset).toBeGreaterThan(0);
  });

  // ---- onCorruptLine callback ----

  it("should invoke onCorruptLine callback for each corrupted line", async () => {
    const corrupted: { line: string; error: unknown }[] = [];
    const queue = new BaseQueue<TestRecord>(
      tempDir,
      "test.jsonl",
      "test.state.json",
      (line, error) => corrupted.push({ line, error }),
    );
    const queuePath = join(tempDir, "test.jsonl");

    const lines = [
      JSON.stringify(makeRecord(1)),
      "bad-line-1",
      JSON.stringify(makeRecord(3)),
      "bad-line-2",
      "",
    ].join("\n");
    await writeFile(queuePath, lines);

    const { records } = await queue.readFromOffset(0);

    expect(records).toHaveLength(2);
    expect(corrupted).toHaveLength(2);
    expect(corrupted[0].line).toBe("bad-line-1");
    expect(corrupted[1].line).toBe("bad-line-2");
    expect(corrupted[0].error).toBeInstanceOf(SyntaxError);
  });

  it("should not fail when onCorruptLine is not provided", async () => {
    // This is the default behaviour (no callback) — should not throw
    const queue = createQueue(tempDir);
    const queuePath = join(tempDir, "test.jsonl");
    await writeFile(queuePath, "bad\n");

    const { records } = await queue.readFromOffset(0);
    expect(records).toEqual([]);
  });

  // ---- offset persistence ----

  it("should save and load upload offset", async () => {
    const queue = createQueue(tempDir);
    await queue.saveOffset(4096);
    const offset = await queue.loadOffset();
    expect(offset).toBe(4096);
  });

  it("should return 0 offset when state file does not exist", async () => {
    const queue = createQueue(tempDir);
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  it("should handle corrupted state file gracefully", async () => {
    await writeFile(join(tempDir, "test.state.json"), "broken{{{");
    const queue = createQueue(tempDir);
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  it("defaults missing offset to 0 when state JSON omits the field", async () => {
    // Cover the `state.offset ?? 0` branch in loadState() when the persisted
    // JSON is well-formed but lacks an explicit offset field.
    await writeFile(
      join(tempDir, "test.state.json"),
      JSON.stringify({ dirtyKeys: ["bucket-1"] }),
    );
    const queue = createQueue(tempDir);
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  // ---- queuePath exposed ----

  it("should expose queuePath", () => {
    const queue = createQueue(tempDir);
    expect(queue.queuePath).toBe(join(tempDir, "test.jsonl"));
  });

  // ---- overwrite ----

  it("should overwrite queue with new records (replacing old)", async () => {
    const queue = createQueue(tempDir);
    await queue.appendBatch([makeRecord(1), makeRecord(2)]);

    // Overwrite with different records
    await queue.overwrite([makeRecord(10), makeRecord(20), makeRecord(30)]);

    const { records } = await queue.readFromOffset(0);
    expect(records).toHaveLength(3);
    expect(records[0].id).toBe(10);
    expect(records[1].id).toBe(20);
    expect(records[2].id).toBe(30);
  });

  it("should overwrite with empty array to clear queue", async () => {
    const queue = createQueue(tempDir);
    await queue.appendBatch([makeRecord(1), makeRecord(2)]);

    await queue.overwrite([]);

    const { records, newOffset } = await queue.readFromOffset(0);
    expect(records).toEqual([]);
    expect(newOffset).toBe(0);
  });

  it("should overwrite when queue file does not exist yet", async () => {
    const queue = createQueue(tempDir);
    await queue.overwrite([makeRecord(1)]);

    const { records } = await queue.readFromOffset(0);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(1);
  });

  it("should overwrite atomically (tmp → rename)", async () => {
    const queue = createQueue(tempDir);
    await queue.appendBatch([makeRecord(1)]);

    // Overwrite and verify no .tmp file remains
    await queue.overwrite([makeRecord(99)]);

    const tmpPath = join(tempDir, "test.jsonl.tmp");
    let tmpExists = true;
    try {
      await readFile(tmpPath);
    } catch {
      tmpExists = false;
    }
    expect(tmpExists).toBe(false);

    const { records } = await queue.readFromOffset(0);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(99);
  });

  it("should create directory on overwrite if it does not exist", async () => {
    const nestedDir = join(tempDir, "deep", "nested2");
    const queue = new BaseQueue<TestRecord>(
      nestedDir,
      "test.jsonl",
      "test.state.json",
    );
    await queue.overwrite([makeRecord(42)]);

    const raw = await readFile(join(nestedDir, "test.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).id).toBe(42);
  });

  // -----------------------------------------------------------------------
  // Dirty-keys state management
  // -----------------------------------------------------------------------

  it("should return undefined dirtyKeys for fresh (no state file) queue", async () => {
    const queue = createQueue(tempDir);
    const keys = await queue.loadDirtyKeys();
    expect(keys).toBeUndefined();
  });

  it("should return undefined dirtyKeys for legacy state file (offset only)", async () => {
    const queue = createQueue(tempDir);
    // Simulate legacy state file written by old version
    await writeFile(join(tempDir, "test.state.json"), '{"offset":42}\n');
    const keys = await queue.loadDirtyKeys();
    expect(keys).toBeUndefined();
  });

  it("should save and load dirty keys", async () => {
    const queue = createQueue(tempDir);
    const dirtyKeys = ["claude-code|sonnet|2026-03-14T10:00:00.000Z|dev1"];
    await queue.saveDirtyKeys(dirtyKeys);

    const loaded = await queue.loadDirtyKeys();
    expect(loaded).toEqual(dirtyKeys);
  });

  it("should save empty dirtyKeys array (distinct from undefined)", async () => {
    const queue = createQueue(tempDir);
    await queue.saveDirtyKeys([]);

    const loaded = await queue.loadDirtyKeys();
    expect(loaded).toEqual([]);
    // Must be an empty array, NOT undefined
    expect(loaded).not.toBeUndefined();
  });

  it("should preserve dirtyKeys when saving offset", async () => {
    const queue = createQueue(tempDir);
    const dirtyKeys = ["key-a", "key-b"];
    await queue.saveDirtyKeys(dirtyKeys);
    await queue.saveOffset(999);

    const loaded = await queue.loadDirtyKeys();
    expect(loaded).toEqual(dirtyKeys);
    expect(await queue.loadOffset()).toBe(999);
  });

  it("should preserve offset when saving dirtyKeys", async () => {
    const queue = createQueue(tempDir);
    await queue.saveOffset(500);
    await queue.saveDirtyKeys(["key-x"]);

    expect(await queue.loadOffset()).toBe(500);
    expect(await queue.loadDirtyKeys()).toEqual(["key-x"]);
  });

  it("should clear dirtyKeys by saving undefined", async () => {
    const queue = createQueue(tempDir);
    await queue.saveDirtyKeys(["key-a"]);
    expect(await queue.loadDirtyKeys()).toEqual(["key-a"]);

    await queue.saveDirtyKeys(undefined);
    expect(await queue.loadDirtyKeys()).toBeUndefined();
  });

  it("should load full state with both offset and dirtyKeys", async () => {
    const queue = createQueue(tempDir);
    await queue.saveState({ offset: 123, dirtyKeys: ["k1", "k2"] });

    const state = await queue.loadState();
    expect(state.offset).toBe(123);
    expect(state.dirtyKeys).toEqual(["k1", "k2"]);
  });

  it("should return default state for missing state file", async () => {
    const queue = createQueue(tempDir);
    const state = await queue.loadState();
    expect(state.offset).toBe(0);
    expect(state.dirtyKeys).toBeUndefined();
  });
});

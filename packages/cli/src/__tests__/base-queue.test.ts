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

  // ---- queuePath exposed ----

  it("should expose queuePath", () => {
    const queue = createQueue(tempDir);
    expect(queue.queuePath).toBe(join(tempDir, "test.jsonl"));
  });
});

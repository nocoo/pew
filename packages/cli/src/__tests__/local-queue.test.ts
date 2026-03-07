import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalQueue } from "../storage/local-queue.js";
import type { QueueRecord } from "@zebra/core";

function makeRecord(overrides: Partial<QueueRecord> = {}): QueueRecord {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-07T10:30:00.000Z",
    input_tokens: 5000,
    cached_input_tokens: 1000,
    output_tokens: 2000,
    reasoning_output_tokens: 0,
    total_tokens: 7000,
    ...overrides,
  };
}

describe("LocalQueue", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-queue-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should append records to JSONL file", async () => {
    const queue = new LocalQueue(tempDir);
    const record = makeRecord();
    await queue.append(record);

    const raw = await readFile(join(tempDir, "queue.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(record);
  });

  it("should append multiple records", async () => {
    const queue = new LocalQueue(tempDir);
    await queue.append(makeRecord({ model: "model-a" }));
    await queue.append(makeRecord({ model: "model-b" }));
    await queue.append(makeRecord({ model: "model-c" }));

    const raw = await readFile(join(tempDir, "queue.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).model).toBe("model-a");
    expect(JSON.parse(lines[2]).model).toBe("model-c");
  });

  it("should appendBatch atomically", async () => {
    const queue = new LocalQueue(tempDir);
    const records = [
      makeRecord({ model: "a" }),
      makeRecord({ model: "b" }),
      makeRecord({ model: "c" }),
    ];
    await queue.appendBatch(records);

    const raw = await readFile(join(tempDir, "queue.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("should create directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "deep", "nested");
    const queue = new LocalQueue(nestedDir);
    await queue.append(makeRecord());

    const raw = await readFile(join(nestedDir, "queue.jsonl"), "utf-8");
    expect(raw.trim().length).toBeGreaterThan(0);
  });

  it("should read unuploaded records starting from offset", async () => {
    const queue = new LocalQueue(tempDir);
    await queue.append(makeRecord({ model: "a" }));
    await queue.append(makeRecord({ model: "b" }));

    const { records, newOffset } = await queue.readFromOffset(0);
    expect(records).toHaveLength(2);
    expect(records[0].model).toBe("a");
    expect(records[1].model).toBe("b");
    expect(newOffset).toBeGreaterThan(0);
  });

  it("should read only new records after offset", async () => {
    const queue = new LocalQueue(tempDir);
    await queue.append(makeRecord({ model: "a" }));

    const { newOffset: offset1 } = await queue.readFromOffset(0);

    await queue.append(makeRecord({ model: "b" }));
    const { records, newOffset: offset2 } = await queue.readFromOffset(offset1);
    expect(records).toHaveLength(1);
    expect(records[0].model).toBe("b");
    expect(offset2).toBeGreaterThan(offset1);
  });

  it("should return empty array when queue file does not exist", async () => {
    const queue = new LocalQueue(tempDir);
    const { records, newOffset } = await queue.readFromOffset(0);
    expect(records).toEqual([]);
    expect(newOffset).toBe(0);
  });

  it("should save and load upload offset", async () => {
    const queue = new LocalQueue(tempDir);
    await queue.saveOffset(4096);
    const offset = await queue.loadOffset();
    expect(offset).toBe(4096);
  });

  it("should return 0 offset when state file does not exist", async () => {
    const queue = new LocalQueue(tempDir);
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  it("should handle corrupted state file gracefully", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tempDir, "queue.state.json"), "broken{{{");
    const queue = new LocalQueue(tempDir);
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  it("should expose filePath", () => {
    const queue = new LocalQueue(tempDir);
    expect(queue.queuePath).toBe(join(tempDir, "queue.jsonl"));
  });
});

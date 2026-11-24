import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { QueueRecord } from "@pew/core";
import type { ParsedDelta } from "../parsers/claude.js";
import {
  antigravityRecords,
  readAntigravityBaseline,
  replaceAntigravityPartition,
} from "./antigravity-snapshot.js";

const delta = (input = 100): ParsedDelta => ({
  source: "antigravity",
  model: "test-model",
  timestamp: "2026-10-01T12:29:59.999Z",
  tokens: {
    inputTokens: input,
    cachedInputTokens: 900,
    outputTokens: 40,
    reasoningOutputTokens: 60,
  },
});
const record = (
  source: QueueRecord["source"] = "antigravity",
  device_id = "device",
): QueueRecord => ({
  source,
  device_id,
  model: "test-model",
  hour_start: "2026-10-01T12:00:00.000Z",
  input_tokens: 100,
  cached_input_tokens: 900,
  output_tokens: 40,
  reasoning_output_tokens: 60,
  total_tokens: 1100,
});

describe("Antigravity absolute source partitions", () => {
  it("reads retained history fail-closed before any source reset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-agy-baseline-"));
    try {
      expect(await readAntigravityBaseline(dir)).toEqual([]);
      await writeFile(
        join(dir, "queue.jsonl"),
        `${JSON.stringify(record())}\n${JSON.stringify(record("pi"))}\n`,
      );
      expect(await readAntigravityBaseline(dir)).toEqual([record()]);
      for (const raw of [
        "PRIVATE{",
        "null",
        '{"source":"antigravity"}',
        JSON.stringify({ ...record(), total_tokens: 1 }),
      ]) {
        await writeFile(join(dir, "queue.jsonl"), raw);
        await expect(readAntigravityBaseline(dir)).rejects.toThrow(
          "Cannot verify previous usage queue",
        );
      }
      await rm(join(dir, "queue.jsonl"));
      await mkdir(join(dir, "queue.jsonl"));
      await expect(readAntigravityBaseline(dir)).rejects.toThrow(
        "Cannot verify previous usage queue",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("never adds a rescanned snapshot to the previous snapshot", () => {
    const fresh = antigravityRecords([delta()], "device");
    expect(fresh).toEqual([record()]);
    expect(
      replaceAntigravityPartition([record(), record("pi")], [record("pi")], fresh, "device")
        .records,
    ).toEqual([record("pi"), record()]);
  });

  it("corrects counters and emits tombstones for moved/deleted buckets only on this device", () => {
    const old = record();
    const fresh = [{ ...old, model: "corrected-model", input_tokens: 50, total_tokens: 1050 }];
    const result = replaceAntigravityPartition(
      [old, record("antigravity", "other"), record("pi")],
      [record("pi")],
      fresh,
      "device",
    );
    expect(result.records).toContainEqual(record("antigravity", "other"));
    expect(result.records).toContainEqual(record("pi"));
    expect(result.records).toContainEqual(fresh[0]);
    expect(result.tombstones).toMatchObject([
      {
        ...old,
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
      },
    ]);
    expect(result.records).toContainEqual(result.tombstones[0]);
    expect(replaceAntigravityPartition([old], [], [], "device").records[0].total_tokens).toBe(0);
  });

  it("preserves all old source partitions when the source cannot be validated, including reset", () => {
    const prior = [record(), record("antigravity", "other"), record("pi")];
    expect(replaceAntigravityPartition(prior, [record("pi")], null, "device").records).toEqual([
      record("pi"),
      record("antigravity", "other"),
      record(),
    ]);
  });

  it("rejects invalid timestamps, cross-source data and unsafe aggregate counts", () => {
    for (const d of [
      { ...delta(), timestamp: "bad" },
      { ...delta(), source: "pi" as const },
      delta(-1),
      delta(Number.MAX_SAFE_INTEGER),
    ]) {
      expect(() => antigravityRecords([d], "device")).toThrow();
    }
    expect(() => antigravityRecords([delta(600_000_000), delta(600_000_000)], "device")).toThrow();
    expect(antigravityRecords([], "device")).toEqual([]);
  });
});

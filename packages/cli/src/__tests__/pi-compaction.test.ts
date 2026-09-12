import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePiFile } from "../parsers/pi.js";

const timestamp = "2026-09-06T16:00:01.000Z";
const usage = { input: 100, output: 20, cacheRead: 30, cacheWrite: 5, reasoning: 4 };
const header = { type: "session", id: "synthetic-session", timestamp };
const model = { type: "model_change", modelId: "gemini-3.8-flash", provider: "google", timestamp };
const compact = {
  type: "compaction", id: "compact-1", timestamp, usage,
  summary: "PRIVATE_FIXTURE_BODY", tokensBefore: 99999, firstKeptEntryId: "old-1",
};

describe("Pi compaction accounting", () => {
  let dir: string;
  let filePath: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-compaction-"));
    filePath = join(dir, "session.jsonl");
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function fixture(rows: unknown[]) {
    await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  }

  it("captures top-level usage at compaction completion without changing the token convention", async () => {
    await fixture([header, model, compact]);
    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({
      source: "pi", model: "gemini-3.8-flash", timestamp,
      tokens: { inputTokens: 105, cachedInputTokens: 30, outputTokens: 16, reasoningOutputTokens: 4 },
      evidence: { callType: "compaction", granularity: "operation", timePrecision: "exact", snapshotSeq: 1 },
    });
    expect(result.deltas[0].evidence?.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FIXTURE_BODY");
  });

  it.each(["stop", "error", "aborted"])("counts provider-confirmed %s usage and ignores zero usage", async (stopReason) => {
    await fixture([header, model, { ...compact, stopReason }, {
      ...compact, id: "zero", usage: { input: 0, output: 0 }, stopReason,
    }]);
    expect((await parsePiFile({ filePath, startOffset: 0 })).deltas).toHaveLength(1);
  });

  it("deduplicates a replayed compaction by identity, never by equal token counts", async () => {
    await fixture([header, model, compact, compact, { ...compact, id: "compact-2" }]);
    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(2);
    expect(new Set(result.deltas.map((d) => d.evidence?.eventId)).size).toBe(2);
  });

  it("keeps identity and model stable on incremental reads, reset and renamed copies", async () => {
    await fixture([header, model]);
    const first = await parsePiFile({ filePath, startOffset: 0 });
    await appendFile(filePath, `${JSON.stringify(compact)}\n`);
    const incremental = await parsePiFile({ filePath, startOffset: first.endOffset });
    const replay = await parsePiFile({ filePath, startOffset: 0 });
    const rotatedPath = join(dir, "rotated.jsonl");
    await writeFile(rotatedPath, `${[header, model, compact].map((r) => JSON.stringify(r)).join("\n")}\n`);
    const rotated = await parsePiFile({ filePath: rotatedPath, startOffset: 0 });
    expect(incremental.deltas).toHaveLength(1);
    expect(incremental.deltas).toEqual(replay.deltas);
    expect(rotated.deltas).toEqual(replay.deltas);
  });

  it("keeps assistant usage unchanged and ignores proxy/custom copies of the same request", async () => {
    const assistant = { type: "message", id: "assistant-1", timestamp,
      message: { role: "assistant", model: "gemini-3.8-flash", usage, content: "PRIVATE_FIXTURE_BODY" } };
    await fixture([header, model, assistant, compact,
      { type: "custom", customType: "raven_request", id: compact.id, usage, timestamp },
    ]);
    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(2);
    expect(result.deltas.filter((d) => !d.evidence)).toEqual([{
      source: "pi", model: "gemini-3.8-flash", timestamp,
      tokens: { inputTokens: 105, cachedInputTokens: 30, outputTokens: 16, reasoningOutputTokens: 4 },
    }]);
  });

  it("does not invent an event identity or timestamp when accounting evidence is incomplete", async () => {
    await fixture([header, model, { ...compact, id: undefined }, { ...compact, timestamp: "invalid" }]);
    expect((await parsePiFile({ filePath, startOffset: 0 })).deltas).toEqual([]);
  });

  it("does not enable compaction accounting for the separate Oh My Pi source", async () => {
    await fixture([header, model, compact]);
    expect((await parsePiFile({ filePath, startOffset: 0, source: "omp" })).deltas).toEqual([]);
  });

  it("recognizes inherited compactions after Pi forks history under a new session header", async () => {
    await fixture([header, model, compact]);
    const original = await parsePiFile({ filePath, startOffset: 0 });
    await fixture([{ ...header, id: "forked-session", parentSession: "synthetic-parent.jsonl" }, model, compact]);
    const fork = await parsePiFile({ filePath, startOffset: 0 });
    expect(fork.deltas).toEqual(original.deltas);
  });

  it("does not let a zero-usage interrupted record claim the eventual billed event identity", async () => {
    await fixture([header, model, { ...compact, usage: { input: 0, output: 0 }, stopReason: "aborted" }, compact]);
    expect((await parsePiFile({ filePath, startOffset: 0 })).deltas).toHaveLength(1);
  });

  it("recovers a partial compaction line and labels an extension's unknown model honestly", async () => {
    await fixture([header, model]);
    const text = JSON.stringify({ ...compact, fromHook: true });
    await appendFile(filePath, text.slice(0, 30));
    const partial = await parsePiFile({ filePath, startOffset: 0 });
    expect(partial.deltas).toEqual([]);
    await appendFile(filePath, `${text.slice(30)}\n`);
    const complete = await parsePiFile({ filePath, startOffset: partial.endOffset });
    expect(complete.deltas).toMatchObject([{ model: "unknown", evidence: { callType: "compaction" } }]);
  });
});

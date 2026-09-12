import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EvidenceRecord } from "@pew/core";
import { EvidenceQueue } from "../storage/evidence-queue.js";
import { toEvidenceRecord } from "../utils/usage-evidence.js";

const good: EvidenceRecord = {
  source: "hermes", model: "test-model", device_id: "test-device",
  timestamp: "2026-09-06T16:00:01.000Z", hour_start: "2026-09-06T16:00:00.000Z",
  input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120,
  evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "approval", origin: "hermes-aux-ledger",
    provider: "openai", granularity: "session", timePrecision: "session-start", intervalStart: null,
    intervalEnd: null, callCount: 1, snapshotSeq: 1 },
};

describe("durable usage evidence", () => {
  let dir: string;
  let queue: EvidenceQueue;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "pew-evidence-queue-")); queue = new EvidenceQueue(dir); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("replaces absolute snapshots and ignores older offline deliveries", async () => {
    await queue.merge([good]);
    const newer = { ...good, input_tokens: 200, total_tokens: 220, evidence: { ...good.evidence, snapshotSeq: 2 } };
    await queue.merge([newer]);
    await queue.merge([good]);
    expect((await queue.readFromOffset(0)).records).toEqual([newer]);
  });

  it("fails closed for conflicting same-revision values and rebucketing attempts", async () => {
    await queue.merge([good]);
    await expect(queue.merge([{ ...good, input_tokens: 200, total_tokens: 220 }])).rejects.toThrow("Conflicting usage evidence snapshot");
    await expect(queue.merge([{ ...good, timestamp: "2026-09-07T16:00:01.000Z", hour_start: "2026-09-07T16:00:00.000Z",
      evidence: { ...good.evidence, snapshotSeq: 2 } }])).rejects.toThrow("Conflicting usage evidence snapshot");
    expect((await queue.readFromOffset(0)).records).toEqual([good]);
  });

  it.each([
    { evidence: undefined }, { evidence: { ...good.evidence, snapshotSeq: -1 } },
    { input_tokens: -1 }, { total_tokens: 999 }, { hour_start: "invalid" },
    { model: "Bearer PRIVATE_FIXTURE_BODY" }, { prompt: "PRIVATE_FIXTURE_BODY" },
  ])("never forwards an invalid saved ledger (#%#)", async (override) => {
    await writeFile(queue.queuePath, `${JSON.stringify({ ...good, ...override })}\n`);
    await expect(queue.readFromOffset(0)).rejects.toThrow("Invalid usage evidence ledger");
  });

  it("does not accept a delta without accounting identity", () => {
    expect(() => toEvidenceRecord({ source: "pi", model: "m", timestamp: good.timestamp,
      tokens: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }, "d"))
      .toThrow("Invalid usage evidence");
  });

  it("rejects immutable provenance changes that the server cannot accept", async () => {
    await queue.merge([good]);
    for (const change of [
      { origin: "hermes-acp-ledger" as const }, { provider: "anthropic" }, { granularity: "operation" as const },
      { timePrecision: "unattributed" as const }, { intervalStart: "2026-09-05T00:00:00.000Z" },
    ]) {
      await expect(queue.merge([{ ...good, evidence: { ...good.evidence, ...change, snapshotSeq: 2 } }]))
        .rejects.toThrow("Conflicting usage evidence snapshot");
    }
    expect((await queue.readFromOffset(0)).records).toEqual([good]);
  });

  it("fails closed before persisting unknown incoming payload fields", async () => {
    await expect(queue.merge([{ ...good, prompt: "PRIVATE_FIXTURE_BODY" } as EvidenceRecord]))
      .rejects.toThrow("Invalid usage evidence ledger");
    expect((await queue.readFromOffset(0)).records).toEqual([]);
  });

  it("rejects saved device IDs, source/origin mismatches and invalid interval bounds", async () => {
    for (const r of [
      { ...good, device_id: "PRIVATE FIXTURE BODY" },
      { ...good, evidence: { ...good.evidence, origin: "pi-session" } },
      { ...good, evidence: { ...good.evidence, intervalStart: "2026-09-06T00:00:00" } },
      { ...good, evidence: { ...good.evidence, intervalStart: "2026-09-08T00:00:00Z", intervalEnd: "2026-09-07T00:00:00Z" } },
    ]) {
      await writeFile(queue.queuePath, `${JSON.stringify(r)}\n`);
      await expect(queue.readFromOffset(0)).rejects.toThrow("Invalid usage evidence ledger");
    }
  });

  it("never constructs unsafe counters or an unhashable accounting identity", () => {
    const delta = { source: good.source, model: good.model, timestamp: good.timestamp,
      tokens: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 }, evidence: good.evidence };
    for (const changed of [
      { ...delta, evidence: { ...good.evidence, eventId: "raw-private-id" } },
      { ...delta, evidence: { ...good.evidence, groupId: "raw-private-id" } },
      { ...delta, evidence: { ...good.evidence, snapshotSeq: 0 } },
      { ...delta, tokens: { ...delta.tokens, inputTokens: -1 } },
      { ...delta, tokens: { ...delta.tokens, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } },
    ]) expect(() => toEvidenceRecord(changed, "test-device")).toThrow("Invalid usage evidence");
  });
});

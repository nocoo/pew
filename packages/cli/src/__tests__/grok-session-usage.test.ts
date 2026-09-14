import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accumulateSessionUsage,
  excludeOccupiedBuckets,
  parseGrokSessionUsageFile,
  parseTurnCompletedLine,
  readGrokAccountingSnapshots,
  sessionUsageToIngestRecords,
  toSessionUsageDelta,
} from "../parsers/grok-session-usage.js";
import type { SessionUsageSnapshot } from "../parsers/grok-session-usage.js";

function snap(
  overrides: Partial<SessionUsageSnapshot> = {},
): SessionUsageSnapshot {
  return {
    inputTokens: 100,
    cachedReadTokens: 40,
    outputTokens: 20,
    reasoningTokens: 5,
    numTurns: 1,
    modelCalls: 1,
    ...overrides,
  };
}

function turnLine(opts: {
  timestamp?: number;
  agentTimestampMs?: number;
  usage: Record<string, unknown>;
  model?: string;
  eventId?: string;
  omitMeta?: boolean;
}): string {
  const usage = {
    ...opts.usage,
    modelUsage: opts.usage.modelUsage ?? {
      [opts.model ?? "grok-4.6"]: opts.usage,
    },
  };
  const params: Record<string, unknown> = {
    sessionId: "sid",
    update: {
      sessionUpdate: "turn_completed",
      usage,
    },
  };
  if (!opts.omitMeta) {
    params._meta = {
      agentTimestampMs: opts.agentTimestampMs ?? 1_788_245_632_727,
      ...(opts.eventId ? { eventId: opts.eventId } : {}),
    };
  }
  return JSON.stringify({
    timestamp: opts.timestamp ?? 1_788_245_632,
    method: "session/update",
    params,
  });
}

describe("toSessionUsageDelta", () => {
  it("normalizes each prompt snapshot in full", () => {
    expect(
      toSessionUsageDelta(
        snap({
          inputTokens: 21601,
          cachedReadTokens: 11136,
          outputTokens: 193,
          reasoningTokens: 48,
        }),
      ),
    ).toEqual({
      inputTokens: 10465,
      cachedInputTokens: 11136,
      outputTokens: 145,
      reasoningOutputTokens: 48,
    });
  });
});

describe("Grok accounting details", () => {
  it("keeps inclusive ACP inputs, creation tokens, per-model groups and exact server ticks", () => {
    const a = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1, costUsdTicks: "123456789" };
    const b = { ...a, costUsdTicks: "100000001" };
    const usage = { inputTokens: 200, cachedReadTokens: 80, cacheCreationTokens: 40, outputTokens: 40, reasoningTokens: 10, modelCalls: 2,
      costUsdTicks: "223456790", modelUsage: { "grok-4.6": a, "grok-4.6-mini": b } };
    const event = parseTurnCompletedLine(turnLine({ usage, eventId: "stable" }), true);
    if (!event) throw new Error("Expected turn");
    const deltas = accumulateSessionUsage([event, event]);
    expect(deltas).toHaveLength(2);
    expect(deltas.map((d) => d.model)).toEqual(["grok-4.6", "grok-4.6"]);
    expect(deltas.map((d) => d.accounting?.model)).toEqual(["grok-4.6", "grok-4.6-mini"]);
    expect(deltas[0].accounting).toMatchObject({ counts: { input_total_tokens: 100, cache_write_input_tokens: 20, output_total_tokens: 20 },
      reported_costs: [{ units: "123456789", scale: 10, kind: "actual", status: "complete" }] });
    expect(sessionUsageToIngestRecords(deltas, { deviceId: "test" })[0].total_tokens).toBe(240);
  });

  it("does not claim partial server costs are complete or missing writes are zero", () => {
    const event = parseTurnCompletedLine(turnLine({ usage: { inputTokens: 100, outputTokens: 10, cachedReadTokens: 20,
      modelCalls: 2, costUsdTicks: 100, cost_is_partial: true } }), true);
    if (!event) throw new Error("Expected turn");
    const [d] = accumulateSessionUsage([event]);
    expect(d.accounting?.counts?.cache_write_input_tokens).toBeNull();
    expect(d.accounting?.reported_costs[0]).toMatchObject({ units: "100", status: "partial" });
    expect(d.accounting?.context_tokens_min).toBeNull();
  });

  it("pins the accounting read to complete JSONL lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-grok-accounting-"));
    try {
      const file = join(dir, "updates.jsonl");
      const line = turnLine({ usage: { inputTokens: 100, outputTokens: 10 }, eventId: "one" });
      await writeFile(file, `${line}\n${line}`);
      expect(await parseGrokSessionUsageFile(file, new Set(), { includeAccounting: true })).toHaveLength(1);
      expect(await parseGrokSessionUsageFile(file, new Set(), { includeAccounting: true, endBound: 1 })).toHaveLength(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("retains nested and envelope completeness flags", () => {
    const counts = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1, costUsdTicks: 100 };
    const nested = parseTurnCompletedLine(turnLine({ usage: { ...counts, modelUsage: { "grok-4.6": { ...counts, usageIsIncomplete: true } } } }), true);
    expect(nested?.accounting?.[0].reported_costs[0].status).toBe("partial");
    const envelope = JSON.parse(turnLine({ usage: counts }));
    envelope.params.update.costIsPartial = true;
    expect(parseTurnCompletedLine(JSON.stringify(envelope), true)?.accounting?.[0].reported_costs[0].status).toBe("partial");
  });

  it("deduplicates compatible fork copies but refuses conflicting cache splits for the whole bucket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-grok-forks-"));
    try {
      const a = join(dir, "a"); const b = join(dir, "b");
      await mkdir(a); await mkdir(b);
      const usage = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1 };
      await writeFile(join(a, "updates.jsonl"), `${turnLine({ usage, eventId: "shared" })}\n`);
      await writeFile(join(b, "updates.jsonl"), `${turnLine({ usage: { ...usage, costUsdTicks: 100 }, eventId: "shared" })}\n`);
      const compatible = await readGrokAccountingSnapshots(dir);
      expect(compatible).toHaveLength(1);
      expect(compatible[0].accounting?.reported_costs[0].units).toBe("100");
      await writeFile(join(b, "updates.jsonl"), `${turnLine({ usage: { ...usage, cacheCreationTokens: 30 }, eventId: "shared" })}\n`);
      expect(await readGrokAccountingSnapshots(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("enriches a matching identified update from usage.json without adding inherited totals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-grok-money-"));
    try {
      const usage = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1 };
      const file = join(dir, "updates.jsonl");
      const time = Date.parse("2026-09-01T00:00:01.000Z");
      await writeFile(file, `${turnLine({ usage, eventId: "one", agentTimestampMs: time })}\n`);
      const amount = { ...usage, costUsdTicks: "123456789", endedAt: new Date(time).toISOString(), modelUsage: { "grok-4.6": { ...usage, costUsdTicks: "123456789" } } };
      await writeFile(join(dir, "usage.json"), JSON.stringify({ totals: { inputTokens: 999999 }, turns: [amount, { ...amount, endedAt: new Date(time + 1).toISOString() }] }));
      const deltas = await readGrokAccountingSnapshots(dir);
      expect(deltas).toHaveLength(1);
      expect(deltas[0].accounting?.reported_costs[0].units).toBe("123456789");
      await writeFile(file, "");
      expect(await readGrokAccountingSnapshots(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("keeps nested incomplete status when usage.json supplies a missing amount", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-grok-partial-money-"));
    try {
      const counts = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1 };
      const time = Date.parse("2026-09-01T00:00:01.000Z");
      await writeFile(join(dir, "updates.jsonl"), `${turnLine({ usage: { ...counts, modelUsage: { "grok-4.6": { ...counts, usageIsIncomplete: true } } }, eventId: "partial", agentTimestampMs: time })}\n`);
      const paid = { ...counts, costUsdTicks: "123456789" };
      await writeFile(join(dir, "usage.json"), JSON.stringify({ turns: [{ ...paid, endedAt: new Date(time).toISOString(), modelUsage: { "grok-4.6": paid } }] }));
      const deltas = await readGrokAccountingSnapshots(dir);
      expect(deltas).toHaveLength(1);
      expect(deltas[0].accounting?.reported_costs).toMatchObject([{ units: "123456789", status: "partial" }]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.each([true, false])("preserves incomplete status across matching fork copies (partial first=%s)", async (partialFirst) => {
    const dir = await mkdtemp(join(tmpdir(), "pew-grok-partial-forks-"));
    try {
      const usage = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1 };
      for (const [name, partial] of [["a", partialFirst], ["b", !partialFirst]] as const) {
        const path = join(dir, name); await mkdir(path);
        await writeFile(join(path, "updates.jsonl"), `${turnLine({ usage: { ...usage, ...(partial ? { usageIsIncomplete: true } : { costUsdTicks: 100 }) }, eventId: "shared" })}\n`);
      }
      const deltas = await readGrokAccountingSnapshots(dir);
      expect(deltas).toHaveLength(1);
      expect(deltas[0].accounting?.reported_costs).toMatchObject([{ units: "100", status: "partial" }]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("requires one unambiguous turn with the same canonical cache split before attaching ledger money", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-grok-ledger-match-"));
    try {
      const counts = { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 20, outputTokens: 20, reasoningTokens: 5, modelCalls: 1 };
      const time = Date.parse("2026-09-01T00:00:01.000Z");
      await writeFile(join(dir, "updates.jsonl"), `${turnLine({ usage: counts, eventId: "one", agentTimestampMs: time })}\n`);
      const paid = { ...counts, costUsdTicks: "123456789" };
      const candidate = { ...paid, endedAt: time, modelUsage: { "grok-4.6": paid } };
      for (const body of ["invalid JSON", JSON.stringify(null), JSON.stringify({ turns: {} }),
        JSON.stringify({ turns: [null, { ...candidate, endedAt: "bad" }, { ...candidate, endedAt: null }] }),
        JSON.stringify({ turns: [candidate, candidate] }),
        JSON.stringify({ turns: [{ ...candidate, cacheCreationTokens: 30, modelUsage: { "grok-4.6": { ...paid, cacheCreationTokens: 30 } } }] }),
        JSON.stringify({ turns: [{ ...counts, endedAt: time, modelUsage: { "grok-4.6": counts } }] })]) {
        await writeFile(join(dir, "usage.json"), body);
        const deltas = await readGrokAccountingSnapshots(dir);
        expect(deltas).toHaveLength(1);
        expect(deltas[0]?.accounting?.reported_costs).toEqual([]);
        expect(deltas[0]?.accounting?.counts?.cache_write_input_tokens).toBe(20);
      }
      await writeFile(join(dir, "usage.json"), JSON.stringify({ turns: [candidate] }));
      expect((await readGrokAccountingSnapshots(dir))[0]?.accounting?.reported_costs).toMatchObject([{ units: "123456789", status: "complete" }]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("parseTurnCompletedLine", () => {
  it("reads usage, model, and agentTimestampMs", () => {
    const line = turnLine({
      usage: {
        inputTokens: 100,
        cachedReadTokens: 40,
        outputTokens: 20,
        reasoningTokens: 5,
        numTurns: 1,
        modelCalls: 1,
      },
      eventId: "evt-1",
    });
    const parsed = parseTurnCompletedLine(line);
    expect(parsed?.timestampMs).toBe(1_788_245_632_727);
    expect(parsed?.model).toBe("grok-4.6");
    expect(parsed?.snapshot.inputTokens).toBe(100);
    expect(parsed?.eventId).toBe("evt-1");
  });

  it("falls back to unix-seconds timestamp when _meta is missing", () => {
    const line = turnLine({
      timestamp: 1_788_245_632,
      omitMeta: true,
      usage: { inputTokens: 1, numTurns: 1, modelCalls: 1 },
    });
    expect(parseTurnCompletedLine(line)?.timestampMs).toBe(1_788_245_632_000);
  });

  it("ignores non turn_completed lines", () => {
    expect(parseTurnCompletedLine('{"params":{"update":{"sessionUpdate":"agent_thought_chunk"}}}')).toBeNull();
    expect(parseTurnCompletedLine("not json")).toBeNull();
    expect(parseTurnCompletedLine("null")).toBeNull();
    expect(parseTurnCompletedLine("[]")).toBeNull();
    expect(parseTurnCompletedLine('{"params":null}')).toBeNull();
    expect(parseTurnCompletedLine('{"params":[]}')).toBeNull();
    expect(parseTurnCompletedLine('{"params":{"update":null}}')).toBeNull();
    expect(parseTurnCompletedLine('{"params":{"update":[]}}')).toBeNull();
    expect(
      parseTurnCompletedLine(
        '{"params":{"update":{"sessionUpdate":"turn_completed","usage":null}}}',
      ),
    ).toBeNull();
    expect(
      parseTurnCompletedLine(
        '{"params":{"update":{"sessionUpdate":"turn_completed","usage":[]}}}',
      ),
    ).toBeNull();
  });

  it("returns grok-unknown without modelUsage", () => {
    const line = JSON.stringify({
      timestamp: 1_788_245_632,
      params: {
        update: {
          sessionUpdate: "turn_completed",
          usage: { inputTokens: 1, numTurns: 1, modelCalls: 1, modelUsage: {} },
        },
        _meta: { agentTimestampMs: 1_788_245_632_727 },
      },
    });
    expect(parseTurnCompletedLine(line)?.model).toBe("grok-unknown");
  });

  it("keeps millisecond unix timestamps as-is", () => {
    const line = JSON.stringify({
      timestamp: 1_788_245_632_727,
      params: {
        update: {
          sessionUpdate: "turn_completed",
          usage: { inputTokens: 1, numTurns: 1, modelCalls: 1 },
        },
      },
    });
    expect(parseTurnCompletedLine(line)?.timestampMs).toBe(1_788_245_632_727);
  });

  it("returns null when no timestamp can be read", () => {
    const line = JSON.stringify({
      params: {
        update: {
          sessionUpdate: "turn_completed",
          usage: { inputTokens: 1, numTurns: 1, modelCalls: 1 },
        },
        _meta: [],
      },
    });
    expect(parseTurnCompletedLine(line)).toBeNull();
  });

  it("ignores non-positive agentTimestampMs and uses timestamp seconds", () => {
    const line = JSON.stringify({
      timestamp: 1_788_245_632,
      params: {
        update: {
          sessionUpdate: "turn_completed",
          usage: { inputTokens: 1, numTurns: 1, modelCalls: 1 },
        },
        _meta: { agentTimestampMs: 0 },
      },
    });
    expect(parseTurnCompletedLine(line)?.timestampMs).toBe(1_788_245_632_000);
  });
});

describe("accumulateSessionUsage", () => {
  it("counts each prompt snapshot in full, including after rewind", () => {
    const t0 = 1_788_245_632_727;
    const first = snap({
      inputTokens: 242791,
      cachedReadTokens: 160256,
      outputTokens: 3411,
      reasoningTokens: 2026,
      numTurns: 7,
      modelCalls: 7,
    });
    const second = snap({
      inputTokens: 8532019,
      cachedReadTokens: 8333696,
      outputTokens: 40210,
      reasoningTokens: 14838,
      numTurns: 58,
      modelCalls: 58,
    });
    const third = snap({
      inputTokens: 218205,
      cachedReadTokens: 218112,
      outputTokens: 2014,
      reasoningTokens: 1227,
      numTurns: 1,
      modelCalls: 1,
    });
    const deltas = accumulateSessionUsage([
      { timestampMs: t0, model: "grok-4.6", eventId: "a", snapshot: first },
      {
        timestampMs: t0 + 60_000,
        model: "grok-4.6",
        eventId: "b",
        snapshot: second,
      },
      {
        timestampMs: t0 + 120_000,
        model: "grok-4.6",
        eventId: "c",
        snapshot: third,
      },
    ]);
    expect(deltas).toHaveLength(3);
    expect(deltas[0]?.tokens).toEqual(toSessionUsageDelta(first));
    expect(deltas[1]?.tokens).toEqual(toSessionUsageDelta(second));
    expect(deltas[2]?.tokens).toEqual(toSessionUsageDelta(third));
    expect(deltas[0]?.timestamp).toBe("2026-09-01T06:53:52.727Z");
  });

  it("drops all-zero snapshots", () => {
    const snapshot = snap({
      inputTokens: 0,
      cachedReadTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    });
    expect(
      accumulateSessionUsage([
        {
          timestampMs: 1_788_245_632_727,
          model: "grok-4.6",
          eventId: "z",
          snapshot,
        },
      ]),
    ).toHaveLength(0);
  });

  it("skips duplicate event ids across files", () => {
    const snapshot = snap();
    const seen = new Set<string>();
    const first = accumulateSessionUsage(
      [
        {
          timestampMs: 1_788_245_632_727,
          model: "grok-4.6",
          eventId: "dup",
          snapshot,
        },
      ],
      seen,
    );
    const second = accumulateSessionUsage(
      [
        {
          timestampMs: 1_788_245_632_827,
          model: "grok-4.6",
          eventId: "dup",
          snapshot,
        },
      ],
      seen,
    );
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});

describe("parseGrokSessionUsageFile", () => {
  it("reads turn_completed rows from a jsonl file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pew-gsu-"));
    const file = join(dir, "updates.jsonl");
    try {
      await writeFile(
        file,
        `${turnLine({
          usage: {
            inputTokens: 100,
            cachedReadTokens: 40,
            outputTokens: 20,
            reasoningTokens: 5,
            numTurns: 1,
            modelCalls: 1,
          },
        })}\n{"params":{"update":{"sessionUpdate":"turn_completed","usage":1}}}\n{"params":{"update":{"sessionUpdate":"tool_call"}}}\n`,
      );
      const deltas = await parseGrokSessionUsageFile(file);
      expect(deltas).toHaveLength(1);
      expect(deltas[0]?.source).toBe("grok");
      expect(deltas[0]?.tokens.cachedInputTokens).toBe(40);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sessionUsageToIngestRecords", () => {
  it("aggregates half-hour buckets and skips occupied keys", () => {
    const records = sessionUsageToIngestRecords(
      [
        {
          source: "grok",
          model: "grok-4.6",
          timestamp: "2026-09-01T06:53:52.727Z",
          tokens: {
            inputTokens: 10,
            cachedInputTokens: 20,
            outputTokens: 3,
            reasoningOutputTokens: 1,
          },
        },
        {
          source: "grok",
          model: "grok-4.6",
          timestamp: "2026-09-01T06:59:01.000Z",
          tokens: {
            inputTokens: 5,
            cachedInputTokens: 7,
            outputTokens: 1,
            reasoningOutputTokens: 0,
          },
        },
      ],
      { deviceId: "dev-1" },
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.hour_start).toBe("2026-09-01T06:30:00.000Z");
    expect(records[0]?.input_tokens).toBe(15);
    expect(records[0]?.total_tokens).toBe(15 + 27 + 4 + 1);
  });

  it("skips deltas with unparseable timestamps", () => {
    expect(
      sessionUsageToIngestRecords(
        [
          {
            source: "grok",
            model: "grok-4.6",
            timestamp: "not-a-date",
            tokens: {
              inputTokens: 1,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
          },
        ],
        { deviceId: "dev-1" },
      ),
    ).toEqual([]);
  });
});

describe("excludeOccupiedBuckets", () => {
  it("keeps only hours that are empty in D1", () => {
    const records = [
      {
        source: "grok" as const,
        model: "grok-4.6",
        hour_start: "2026-09-03T15:30:00.000Z",
        device_id: "dev-1",
        input_tokens: 1,
        cached_input_tokens: 2,
        output_tokens: 3,
        reasoning_output_tokens: 4,
        total_tokens: 10,
      },
      {
        source: "grok" as const,
        model: "grok-4.6",
        hour_start: "2026-09-03T16:00:00.000Z",
        device_id: "dev-1",
        input_tokens: 9,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 9,
      },
    ];
    const kept = excludeOccupiedBuckets(
      records,
      new Set(["grok-4.6|2026-09-03T15:30:00.000Z"]),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.hour_start).toBe("2026-09-03T16:00:00.000Z");
  });
});

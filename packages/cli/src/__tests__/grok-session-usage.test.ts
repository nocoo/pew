import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accumulateSessionUsage,
  excludeOccupiedBuckets,
  parseGrokSessionUsageFile,
  parseTurnCompletedLine,
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

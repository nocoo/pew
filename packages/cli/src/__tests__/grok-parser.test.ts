import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeGrokUsage,
  parseGrokLogFile,
  pickModelFromTimeline,
  resolveGrokModel,
  buildGrokModelMaps,
  parseGrokTurnTimeline,
} from "../parsers/grok.js";

const SID = "019f4975-8cf2-7fc2-9d8a-a4297c3a01a7";

function inferenceLine(overrides: {
  ts?: string;
  sid?: string;
  prompt?: number;
  cached?: number;
  completion?: number;
  reasoning?: number;
  loop?: number;
  attempts?: number;
  omitCached?: boolean;
  omitPrompt?: boolean;
  omitCompletion?: boolean;
  omitTs?: boolean;
} = {}): string {
  const ctx: Record<string, unknown> = {
    loop_index: overrides.loop ?? 1,
    attempts: overrides.attempts ?? 1,
  };
  if (!overrides.omitPrompt) ctx.prompt_tokens = overrides.prompt ?? 21601;
  if (!overrides.omitCached) ctx.cached_prompt_tokens = overrides.cached ?? 11136;
  if (!overrides.omitCompletion) ctx.completion_tokens = overrides.completion ?? 193;
  ctx.reasoning_tokens = overrides.reasoning ?? 48;

  const obj: Record<string, unknown> = {
    ts: overrides.omitTs ? undefined : (overrides.ts ?? "2026-07-10T00:37:52.898Z"),
    src: "shell",
    sid: overrides.sid ?? SID,
    msg: "shell.turn.inference_done",
    ctx,
  };
  if (overrides.omitTs) delete obj.ts;
  return JSON.stringify(obj);
}

describe("normalizeGrokUsage", () => {
  it("maps fields with disjoint input/cached and output/reasoning", () => {
    const delta = normalizeGrokUsage({
      prompt_tokens: 21601,
      cached_prompt_tokens: 11136,
      completion_tokens: 193,
      reasoning_tokens: 48,
    });
    expect(delta).toEqual({
      inputTokens: 10465,
      cachedInputTokens: 11136,
      // reasoning is a subset of completion
      outputTokens: 145,
      reasoningOutputTokens: 48,
    });
  });

  it("clamps when cached > prompt", () => {
    const delta = normalizeGrokUsage({
      prompt_tokens: 100,
      cached_prompt_tokens: 200,
      completion_tokens: 1,
      reasoning_tokens: 0,
    });
    expect(delta.inputTokens).toBe(0);
    expect(delta.cachedInputTokens).toBe(200);
  });

  it("clamps when reasoning > completion", () => {
    const delta = normalizeGrokUsage({
      prompt_tokens: 10,
      cached_prompt_tokens: 0,
      completion_tokens: 5,
      reasoning_tokens: 9,
    });
    expect(delta.outputTokens).toBe(0);
    expect(delta.reasoningOutputTokens).toBe(9);
  });

  it("treats missing cached as 0 (full prompt is input)", () => {
    const delta = normalizeGrokUsage({
      prompt_tokens: 500,
      completion_tokens: 10,
    });
    expect(delta.inputTokens).toBe(500);
    expect(delta.cachedInputTokens).toBe(0);
  });

  it("coerces non-numeric to 0", () => {
    const delta = normalizeGrokUsage({
      prompt_tokens: "not a number",
      completion_tokens: 5,
    });
    expect(delta.inputTokens).toBe(0);
    expect(delta.outputTokens).toBe(5);
  });
});

describe("parseGrokLogFile", () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-grok-parser-"));
    logPath = join(dir, "unified.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses a single inference_done line", async () => {
    await writeFile(logPath, `${inferenceLine()}\n`);
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.source).toBe("grok");
    expect(result.deltas[0]!.tokens.inputTokens).toBe(10465);
    expect(result.deltas[0]!.tokens.cachedInputTokens).toBe(11136);
    expect(result.deltas[0]!.tokens.outputTokens).toBe(145); // 193 - 48
    expect(result.deltas[0]!.tokens.reasoningOutputTokens).toBe(48);
    expect(result.deltas[0]!.model).toBe("grok-unknown");
  });

  it("parses 3 real inference_done lines with correct totals", async () => {
    const lines = [
      inferenceLine({
        ts: "2026-07-10T00:37:52.898Z",
        prompt: 21601,
        cached: 11136,
        completion: 193,
        reasoning: 48,
        loop: 1,
      }),
      inferenceLine({
        ts: "2026-07-10T00:37:56.346Z",
        prompt: 31279,
        cached: 21504,
        completion: 213,
        reasoning: 34,
        loop: 2,
      }),
      inferenceLine({
        ts: "2026-07-10T00:38:07.946Z",
        prompt: 36307,
        cached: 31232,
        completion: 1276,
        reasoning: 29,
        loop: 3,
      }),
    ];
    await writeFile(logPath, `${lines.join("\n")}\n`);
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(3);
    const sum = result.deltas.reduce(
      (acc, d) => ({
        in: acc.in + d.tokens.inputTokens,
        cached: acc.cached + d.tokens.cachedInputTokens,
        out: acc.out + d.tokens.outputTokens,
        rea: acc.rea + d.tokens.reasoningOutputTokens,
      }),
      { in: 0, cached: 0, out: 0, rea: 0 },
    );
    // output = completion - reasoning per event: (193-48)+(213-34)+(1276-29)=1571
    expect(sum).toEqual({ in: 25315, cached: 63872, out: 1571, rea: 111 });
    // total_tokens = prompt + completion (no double-count of reasoning)
    expect(sum.in + sum.cached + sum.out + sum.rea).toBe(90869);
  });

  it("skips non-inference_done events", async () => {
    const noise = JSON.stringify({
      ts: "2026-07-10T00:37:00.000Z",
      msg: "phase_changed",
      ctx: {},
    });
    await writeFile(logPath, `${noise}\n${inferenceLine()}\n`);
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("skips when both prompt and completion are missing", async () => {
    await writeFile(
      logPath,
      `${inferenceLine({ omitPrompt: true, omitCompletion: true })}\n`,
    );
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("uses full prompt as input when cached field is missing", async () => {
    await writeFile(
      logPath,
      inferenceLine({ prompt: 1000, omitCached: true, completion: 10, reasoning: 0 }) +
        "\n",
    );
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens.inputTokens).toBe(1000);
    expect(result.deltas[0]!.tokens.cachedInputTokens).toBe(0);
  });

  it("skips malformed JSON without blocking later lines", async () => {
    await writeFile(logPath, `{not json\n${inferenceLine()}\n`);
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("emits every attempt (retries are real API calls)", async () => {
    await writeFile(
      logPath,
      `${[
        inferenceLine({ attempts: 1, loop: 1, ts: "2026-07-10T00:01:00.000Z" }),
        inferenceLine({ attempts: 2, loop: 1, ts: "2026-07-10T00:01:01.000Z" }),
      ].join("\n")}\n`,
    );
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(2);
  });

  it("skips lines missing ts", async () => {
    await writeFile(logPath, `${inferenceLine({ omitTs: true })}\n`);
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("does not advance past a trailing partial line", async () => {
    const complete = `${inferenceLine({ ts: "2026-07-10T00:01:00.000Z" })}\n`;
    const partial = inferenceLine({ ts: "2026-07-10T00:02:00.000Z" }).slice(0, 40);
    await writeFile(logPath, complete + partial);

    const r1 = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(r1.deltas).toHaveLength(1);
    expect(r1.endOffset).toBe(Buffer.byteLength(complete, "utf8"));

    // Finish the partial line
    const rest =
      `${inferenceLine({ ts: "2026-07-10T00:02:00.000Z" }).slice(40)}\n`;
    await writeFile(logPath, complete + partial + rest);

    const r2 = await parseGrokLogFile({
      filePath: logPath,
      startOffset: r1.endOffset,
    });
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0]!.timestamp).toBe("2026-07-10T00:02:00.000Z");
  });

  it("returns startOffset when only a partial line exists", async () => {
    await writeFile(logPath, '{"ts":"2026-07-10T00:01:00.000Z"');
    const result = await parseGrokLogFile({ filePath: logPath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("resolves model from timeline map", async () => {
    await writeFile(logPath, `${inferenceLine({ ts: "2026-07-10T00:10:00.000Z" })}\n`);
    const timeline = new Map([
      [
        SID,
        [
          { ts: "2026-07-10T00:05:00.000Z", modelId: "grok-4.5" },
          { ts: "2026-07-10T00:15:00.000Z", modelId: "grok-code" },
        ],
      ],
    ]);
    const result = await parseGrokLogFile({
      filePath: logPath,
      startOffset: 0,
      sidTurnTimeline: timeline,
      sidPrimaryModel: new Map(),
    });
    expect(result.deltas[0]!.model).toBe("grok-4.5");
  });

  it("falls back to primary model then grok-unknown", async () => {
    await writeFile(logPath, `${inferenceLine()}\n`);
    const withPrimary = await parseGrokLogFile({
      filePath: logPath,
      startOffset: 0,
      sidPrimaryModel: new Map([[SID, "grok-4.5"]]),
    });
    expect(withPrimary.deltas[0]!.model).toBe("grok-4.5");

    const unknown = await parseGrokLogFile({
      filePath: logPath,
      startOffset: 0,
    });
    expect(unknown.deltas[0]!.model).toBe("grok-unknown");
  });
});

describe("pickModelFromTimeline / resolveGrokModel", () => {
  it("picks last turn with ts ≤ event", () => {
    const timeline = [
      { ts: "2026-07-10T00:01:00.000Z", modelId: "A" },
      { ts: "2026-07-10T00:02:00.000Z", modelId: "B" },
    ];
    expect(pickModelFromTimeline(timeline, "2026-07-10T00:01:30.000Z")).toBe("A");
    expect(pickModelFromTimeline(timeline, "2026-07-10T00:02:30.000Z")).toBe("B");
    expect(pickModelFromTimeline(timeline, "2026-07-10T00:00:01.000Z")).toBeNull();
  });

  it("resolveGrokModel falls back through primary to grok-unknown", () => {
    expect(
      resolveGrokModel({
        sid: "s1",
        eventTs: "2026-07-10T00:01:00.000Z",
        sidTurnTimeline: new Map(),
        sidPrimaryModel: new Map([["s1", "primary"]]),
      }),
    ).toBe("primary");
    expect(
      resolveGrokModel({
        sid: "s1",
        eventTs: "2026-07-10T00:01:00.000Z",
        sidTurnTimeline: new Map(),
        sidPrimaryModel: new Map(),
      }),
    ).toBe("grok-unknown");
  });
});

describe("buildGrokModelMaps", () => {
  let root: string;
  let sessionsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pew-grok-models-"));
    sessionsDir = join(root, "sessions");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSession(
    sid: string,
    opts: {
      modelsUsed?: unknown;
      primary?: string;
      events?: string[];
      omitModelsUsed?: boolean;
    },
  ) {
    const dir = join(sessionsDir, "%2Ftmp", sid);
    await mkdir(dir, { recursive: true });
    const signals: Record<string, unknown> = {};
    if (!opts.omitModelsUsed) signals.modelsUsed = opts.modelsUsed ?? ["grok-4.5"];
    if (opts.primary) signals.primaryModelId = opts.primary;
    await writeFile(join(dir, "signals.json"), JSON.stringify(signals));
    if (opts.events) {
      await writeFile(join(dir, "events.jsonl"), `${opts.events.join("\n")}\n`);
    }
  }

  it("fast path: single modelsUsed sets primary without timeline", async () => {
    await writeSession("sid-fast", { modelsUsed: ["grok-4.5"] });
    const maps = await buildGrokModelMaps(sessionsDir);
    expect(maps.sidPrimaryModel.get("sid-fast")).toBe("grok-4.5");
    expect(maps.sidTurnTimeline.has("sid-fast")).toBe(false);
  });

  it("slow path: multi-model builds timeline from events", async () => {
    await writeSession("sid-multi", {
      modelsUsed: ["grok-4.5", "grok-code"],
      primary: "grok-code",
      events: [
        JSON.stringify({
          ts: "2026-07-10T00:01:00.000Z",
          type: "turn_started",
          model_id: "grok-4.5",
        }),
        JSON.stringify({
          ts: "2026-07-10T00:02:00.000Z",
          type: "turn_started",
          model_id: "grok-code",
        }),
      ],
    });
    const maps = await buildGrokModelMaps(sessionsDir);
    expect(maps.sidTurnTimeline.get("sid-multi")).toEqual([
      { ts: "2026-07-10T00:01:00.000Z", modelId: "grok-4.5" },
      { ts: "2026-07-10T00:02:00.000Z", modelId: "grok-code" },
    ]);
    expect(maps.sidPrimaryModel.get("sid-multi")).toBe("grok-code");
  });

  it("slow path: empty modelsUsed scans events", async () => {
    await writeSession("sid-empty", {
      modelsUsed: [],
      primary: "fallback-model",
      events: [
        JSON.stringify({
          ts: "2026-07-10T00:01:00.000Z",
          type: "turn_started",
          model_id: "from-events",
        }),
      ],
    });
    const maps = await buildGrokModelMaps(sessionsDir);
    expect(maps.sidTurnTimeline.get("sid-empty")?.[0]?.modelId).toBe("from-events");
  });

  it("slow path: missing modelsUsed key scans events", async () => {
    await writeSession("sid-omit", {
      omitModelsUsed: true,
      primary: "p",
      events: [
        JSON.stringify({
          ts: "2026-07-10T00:01:00.000Z",
          type: "turn_started",
          model_id: "e",
        }),
      ],
    });
    const maps = await buildGrokModelMaps(sessionsDir);
    expect(maps.sidTurnTimeline.get("sid-omit")?.[0]?.modelId).toBe("e");
  });

  it("parseGrokTurnTimeline skips malformed lines", async () => {
    const path = join(root, "events.jsonl");
    await writeFile(
      path,
      "not-json\n" +
        JSON.stringify({
          ts: "2026-07-10T00:01:00.000Z",
          type: "turn_started",
          model_id: "ok",
        }) +
        "\n",
    );
    const tl = await parseGrokTurnTimeline(path);
    expect(tl).toEqual([{ ts: "2026-07-10T00:01:00.000Z", modelId: "ok" }]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeWorkbuddyUsage,
  parseWorkbuddyFile,
} from "../parsers/workbuddy.js";

const TS_MS = 1757491200000; // 2025-09-10T08:00:00.000Z
const TS_ISO = "2025-09-10T08:00:00.000Z";

/** Build one WorkBuddy JSONL record shaped like the real function_call rows. */
function wbRecord(overrides: {
  messageId?: string;
  type?: string;
  model?: string;
  timestamp?: number | string | null;
  rawUsage?: Record<string, unknown> | null;
  usage?: Record<string, unknown> | null;
  omitProviderData?: boolean;
} = {}): string {
  const rawUsage =
    overrides.rawUsage === undefined
      ? {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200,
          prompt_cache_hit_tokens: 400,
          prompt_cache_miss_tokens: 600,
          cache_creation_input_tokens: 0,
          prompt_cache_write_tokens: 0,
          cache_read_input_tokens: 0,
          cached_tokens: 0,
          completion_thinking_tokens: 50,
          completion_tokens_details: { reasoning_tokens: 50 },
          prompt_tokens_details: { cached_tokens: 400 },
        }
      : overrides.rawUsage;
  const providerData = overrides.omitProviderData
    ? { agent: "cli" }
    : {
        agent: "cli",
        conversationRequestId: "conv-1",
        messageId: overrides.messageId ?? "msg-1",
        model: overrides.model ?? "hy4-preview",
        requestModelId: overrides.model ?? "hy4-preview",
        requestModelName: "Hy4 preview",
        ...(rawUsage ? { rawUsage } : {}),
        ...(overrides.usage !== undefined
          ? { usage: overrides.usage }
          : rawUsage
            ? {
                usage: {
                  requests: 1,
                  inputTokens: rawUsage.prompt_tokens,
                  outputTokens: rawUsage.completion_tokens,
                  totalTokens: rawUsage.total_tokens,
                },
              }
            : {}),
      };
  return JSON.stringify({
    type: overrides.type ?? "function_call",
    id: "rec-1",
    sessionId: "session-1",
    cwd: "/Users/someone/WorkBuddy/2026-09-10-14-51-14",
    timestamp: overrides.timestamp === undefined ? TS_MS : overrides.timestamp,
    providerData,
  });
}

describe("normalizeWorkbuddyUsage", () => {
  it("maps inclusive prompt/completion counters to disjoint TokenDelta fields", () => {
    const delta = normalizeWorkbuddyUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 400,
      prompt_cache_miss_tokens: 600,
      completion_thinking_tokens: 50,
    });
    expect(delta).toEqual({
      inputTokens: 600,
      cachedInputTokens: 400,
      outputTokens: 150,
      reasoningOutputTokens: 50,
    });
  });

  it("falls back to prompt_tokens_details.cached_tokens when prompt_cache_hit_tokens is absent", () => {
    const delta = normalizeWorkbuddyUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 400 },
    });
    expect(delta.cachedInputTokens).toBe(400);
    expect(delta.inputTokens).toBe(600);
  });

  it("prefers the populated cache-hit field over the zero cache_read_input_tokens decoy", () => {
    const delta = normalizeWorkbuddyUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 400,
      cache_read_input_tokens: 0,
      cached_tokens: 0,
    });
    expect(delta.cachedInputTokens).toBe(400);
  });

  it("folds cache-creation tokens into the input bucket (Claude-style)", () => {
    const delta = normalizeWorkbuddyUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 400,
      prompt_cache_miss_tokens: 600,
      cache_creation_input_tokens: 100,
    });
    expect(delta.inputTokens).toBe(700);
    expect(delta.cachedInputTokens).toBe(400);
  });

  it("saturates reasoning at the visible output instead of going negative", () => {
    const delta = normalizeWorkbuddyUsage({
      prompt_tokens: 10,
      completion_tokens: 10,
      completion_thinking_tokens: 40,
    });
    expect(delta.outputTokens).toBe(0);
    expect(delta.reasoningOutputTokens).toBe(40);
  });

  it("returns zeros for missing or invalid fields", () => {
    expect(normalizeWorkbuddyUsage({})).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
    expect(
      normalizeWorkbuddyUsage({
        prompt_tokens: -5,
        completion_tokens: "junk",
        prompt_cache_hit_tokens: Number.NaN,
      }),
    ).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });
});

describe("parseWorkbuddyFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-workbuddy-parser-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits one delta per usage record with source, ISO timestamp and model", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(file, `${wbRecord()}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({
      source: "workbuddy",
      model: "hy4-preview",
      timestamp: TS_ISO,
      tokens: {
        inputTokens: 600,
        cachedInputTokens: 400,
        outputTokens: 150,
        reasoningOutputTokens: 50,
      },
    });
    expect(result.endOffset).toBe(Buffer.byteLength(`${wbRecord()}\n`));
  });

  it("deduplicates records that repeat the same messageId", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(
      file,
      `${wbRecord({ messageId: "msg-1" })}\n${wbRecord({ messageId: "msg-1" })}\n${wbRecord({ messageId: "msg-2" })}\n`,
    );

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(2);
  });

  it("skips records without usage and non-usage record types", async () => {
    const file = join(dir, "session.jsonl");
    const lines = [
      wbRecord({ type: "reasoning", omitProviderData: true }),
      wbRecord({ type: "function_call_result", omitProviderData: true }),
      JSON.stringify({ type: "file-history-snapshot", timestamp: TS_MS }),
      JSON.stringify({ type: "ai-title", aiTitle: "t" }),
      JSON.stringify({ type: "message", role: "user", providerData: { agent: "cli" } }),
      wbRecord(),
    ];
    await writeFile(file, `${lines.join("\n")}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("skips usage records with zero tokens or a missing model", async () => {
    const file = join(dir, "session.jsonl");
    const zero = wbRecord({
      messageId: "msg-zero",
      rawUsage: { prompt_tokens: 0, completion_tokens: 0 },
    });
    const noModel = wbRecord({
      messageId: "msg-nomodel",
      model: "",
    });
    await writeFile(file, `${zero}\n${noModel}\n${wbRecord()}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("does not let a zero-token stub occupy a messageId and suppress the real row", async () => {
    const file = join(dir, "session.jsonl");
    const stub = wbRecord({
      messageId: "dup",
      rawUsage: { prompt_tokens: 0, completion_tokens: 0 },
    });
    const real = wbRecord({ messageId: "dup" });
    await writeFile(file, `${stub}\n${real}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens).toEqual({
      inputTokens: 600,
      cachedInputTokens: 400,
      outputTokens: 150,
      reasoningOutputTokens: 50,
    });
  });

  it("falls back to the camelCase providerData.usage shape", async () => {
    const file = join(dir, "session.jsonl");
    // No rawUsage, no message.usage — the camelCase summary is the only shape,
    // and the array details carry the cache/reasoning split.
    const line = JSON.stringify({
      type: "function_call",
      sessionId: "s",
      cwd: "/x",
      timestamp: TS_MS,
      providerData: {
        agent: "cli",
        messageId: "camel",
        model: "hy4-preview",
        usage: {
          requests: 1,
          inputTokens: 1000,
          outputTokens: 200,
          totalTokens: 1200,
          inputTokensDetails: [{ cached_tokens: 400 }],
          outputTokensDetails: [{ reasoning_tokens: 50 }],
        },
      },
    });
    await writeFile(file, `${line}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens).toEqual({
      inputTokens: 600,
      cachedInputTokens: 400,
      outputTokens: 150,
      reasoningOutputTokens: 50,
    });
  });

  it("accepts prompt_cache_write_tokens as the cache-write alias", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(
      file,
      `${wbRecord({
        messageId: "w",
        rawUsage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200,
          prompt_cache_hit_tokens: 400,
          prompt_cache_miss_tokens: 600,
          prompt_cache_write_tokens: 30,
        },
      })}\n`,
    );

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas[0]!.tokens).toEqual({
      inputTokens: 630,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningOutputTokens: 0,
    });
  });

  it("skips a row whose timestamp is outside the Date range instead of throwing", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(
      file,
      `${wbRecord({ messageId: "bad", timestamp: 1e20 })}\n${wbRecord({ messageId: "good" })}\n`,
    );

    // An out-of-range finite number must not abort the whole file: the bad row
    // is dropped and the good row still yields its delta.
    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.timestamp).toBe(TS_ISO);
  });

  it("does not skip a row whose only usage shape is rawUsage", async () => {
    const file = join(dir, "session.jsonl");
    // No camelCase providerData.usage and no message.usage — the fast filter
    // must still admit the row, since rawUsage is the documented primary shape.
    const onlyRaw = JSON.stringify({
      type: "function_call",
      sessionId: "s",
      cwd: "/x",
      timestamp: TS_MS,
      providerData: {
        agent: "cli",
        messageId: "raw-only",
        model: "hy4-preview",
        rawUsage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_cache_hit_tokens: 40,
          prompt_cache_miss_tokens: 60,
          completion_thinking_tokens: 5,
        },
      },
    });
    await writeFile(file, `${onlyRaw}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens).toEqual({
      inputTokens: 60,
      cachedInputTokens: 40,
      outputTokens: 15,
      reasoningOutputTokens: 5,
    });
  });

  it("falls through an empty rawUsage to a populated message.usage", async () => {
    const file = join(dir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      sessionId: "s",
      cwd: "/x",
      timestamp: TS_MS,
      message: {
        role: "assistant",
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, cache_read_input_tokens: 40 },
      },
      providerData: { agent: "cli", messageId: "m-empty", model: "hy4-preview", rawUsage: {} },
    });
    await writeFile(file, `${line}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens).toEqual({
      inputTokens: 60,
      cachedInputTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 0,
    });
  });

  it("accepts epoch-millisecond numeric timestamps only", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(
      file,
      `${wbRecord({ messageId: "a", timestamp: TS_MS })}\n${wbRecord({ messageId: "b", timestamp: "2025-09-10T08:00:00Z" })}\n`,
    );

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]?.timestamp).toBe(TS_ISO);
  });

  it("reads incrementally from a byte offset and reports the new end offset", async () => {
    const first = `${wbRecord({ messageId: "a" })}\n`;
    const second = `${wbRecord({ messageId: "b" })}\n`;
    const file = join(dir, "session.jsonl");
    await writeFile(file, first + second);

    const result = await parseWorkbuddyFile({
      filePath: file,
      startOffset: Buffer.byteLength(first),
    });
    expect(result.deltas).toHaveLength(1);
    expect(result.endOffset).toBe(Buffer.byteLength(first + second));
  });

  it("stops before an unterminated trailing line and resumes there next sync", async () => {
    const complete = `${wbRecord({ messageId: "a" })}\n`;
    const partial = wbRecord({ messageId: "b" }).slice(0, 40);
    const file = join(dir, "session.jsonl");
    await writeFile(file, complete + partial);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.endOffset).toBe(Buffer.byteLength(complete));
  });

  it("attaches an accounting group when includeAccounting is set", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(file, `${wbRecord()}\n`);

    const result = await parseWorkbuddyFile({
      filePath: file,
      startOffset: 0,
      includeAccounting: true,
    });
    const group = result.deltas[0]?.accounting;
    expect(group?.origin).toBe("workbuddy:usage");
    expect(group?.model).toBe("hy4-preview");
    expect(group?.counts).toMatchObject({
      input_total_tokens: 1000,
      cache_read_input_tokens: 400,
      cache_write_input_tokens: 0,
      output_total_tokens: 200,
      reasoning_output_tokens: 50,
    });
    expect(group?.request_count).toBe(1);
  });

  it("skips a line that is not valid JSON", async () => {
    const file = join(dir, "session.jsonl");
    await writeFile(file, `{"type":"message","usage":\n${wbRecord()}\n`);

    const result = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("returns no deltas for a missing file", async () => {
    const result = await parseWorkbuddyFile({
      filePath: join(dir, "nope.jsonl"),
      startOffset: 0,
    });
    expect(result.deltas).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";

/**
 * Lets a test run code in the window between a parser's `stat()` snapshot and
 * the read that follows it. Without this the "append during parse" scenario
 * is a race: `stat()` and `appendFile()` both go to the libuv threadpool, so
 * the append can land inside the snapshot and the assertion silently passes
 * for the wrong reason. The hook fires once, then clears itself.
 */
const statGate = vi.hoisted(() => ({
  afterStat: null as null | (() => Promise<unknown>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args);
      const hook = statGate.afterStat;
      if (hook) {
        statGate.afterStat = null;
        await hook();
      }
      return result;
    },
  };
});

import { writeFile, appendFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parsePiFile, normalizePiUsage } from "../parsers/pi.js";

describe("normalizePiUsage", () => {
  it("maps pi usage fields to TokenDelta", () => {
    const result = normalizePiUsage({
      input: 3,
      output: 577,
      cacheRead: 0,
      cacheWrite: 19631,
      totalTokens: 20209,
    });
    expect(result).toEqual({
      inputTokens: 3 + 19631, // input + cacheWrite
      cachedInputTokens: 0,
      outputTokens: 577,
      reasoningOutputTokens: 0,
    });
  });

  it("maps cacheRead to cachedInputTokens", () => {
    const result = normalizePiUsage({
      input: 1,
      output: 99,
      cacheRead: 15521,
      cacheWrite: 1448,
    });
    expect(result).toEqual({
      inputTokens: 1 + 1448,
      cachedInputTokens: 15521,
      outputTokens: 99,
      reasoningOutputTokens: 0,
    });
  });

  it("handles missing fields gracefully", () => {
    const result = normalizePiUsage({});
    expect(result).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });

  it("treats negative values as zero", () => {
    const result = normalizePiUsage({ input: -5, output: -1 });
    expect(result).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });

  it("splits omp reasoningTokens out of output (subset, not additive)", () => {
    const result = normalizePiUsage({
      input: 100,
      output: 500,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 600,
      reasoningTokens: 120,
    });
    expect(result).toEqual({
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 380,
      reasoningOutputTokens: 120,
    });
    // Row total is preserved — reasoning is carved out, never added on top
    const total =
      result.inputTokens + result.cachedInputTokens + result.outputTokens + result.reasoningOutputTokens;
    expect(total).toBe(600);
  });

  it("splits pi's legacy `reasoning` spelling the same way", () => {
    const result = normalizePiUsage({ input: 3, output: 123, cacheRead: 0, cacheWrite: 0, reasoning: 26 });
    expect(result.outputTokens).toBe(97);
    expect(result.reasoningOutputTokens).toBe(26);
  });

  it("clamps reasoning to output so outputTokens never goes negative", () => {
    const result = normalizePiUsage({ output: 10, reasoningTokens: 999 });
    expect(result.outputTokens).toBe(0);
    expect(result.reasoningOutputTokens).toBe(10);
  });

  it("treats an absent reasoning field as no split (unknown, not zero-reasoning)", () => {
    const result = normalizePiUsage({ input: 5, output: 50 });
    expect(result.outputTokens).toBe(50);
    expect(result.reasoningOutputTokens).toBe(0);
  });

  it("folds orchestration tokens into the matching buckets", () => {
    // Provider-side orchestration is billed and already counted in the
    // source's own totalTokens (OpenAI / Codex Responses populate it).
    const usage = {
      input: 1000,
      output: 200,
      cacheRead: 300,
      cacheWrite: 50,
      reasoningTokens: 80,
      orchestration: { input: 40, cacheRead: 7, output: 11 },
      totalTokens: 1000 + 200 + 300 + 50 + 40 + 7 + 11,
    };
    const result = normalizePiUsage(usage);
    expect(result).toEqual({
      inputTokens: 1000 + 50 + 40,
      cachedInputTokens: 300 + 7,
      outputTokens: 200 - 80 + 11,
      reasoningOutputTokens: 80,
    });

    // pew's total must still equal the source's own totalTokens
    const total =
      result.inputTokens + result.cachedInputTokens + result.outputTokens + result.reasoningOutputTokens;
    expect(total).toBe(usage.totalTokens);
  });

  it("ignores a malformed orchestration value", () => {
    const result = normalizePiUsage({ input: 5, output: 10, orchestration: "nope" });
    expect(result).toEqual({
      inputTokens: 5,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 0,
    });
  });
});

describe("parsePiFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pew-pi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("parses assistant messages with usage data", async () => {
    const filePath = join(testDir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-04-07T04:41:54.637Z",
        cwd: "/test",
      }),
      JSON.stringify({
        type: "model_change",
        id: "mc1",
        parentId: null,
        timestamp: "2026-04-07T04:41:55.864Z",
        provider: "github-copilot",
        modelId: "claude-opus-4.6-1m",
      }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        parentId: "mc1",
        timestamp: "2026-04-07T04:42:45.105Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          model: "claude-opus-4.6-1m",
          usage: {
            input: 3,
            output: 577,
            cacheRead: 0,
            cacheWrite: 19631,
            totalTokens: 20209,
          },
        },
      }),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toEqual({
      source: "pi",
      model: "claude-opus-4.6-1m",
      timestamp: "2026-04-07T04:42:45.105Z",
      tokens: {
        inputTokens: 3 + 19631,
        cachedInputTokens: 0,
        outputTokens: 577,
        reasoningOutputTokens: 0,
      },
    });
    const st = await stat(filePath);
    expect(result.endOffset).toBe(st.size);
  });

  it("tags deltas with the requested source (omp shares the pi schema)", async () => {
    const filePath = join(testDir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "omp-session",
        timestamp: "2026-08-02T23:13:02.103Z",
        cwd: "/test",
      }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        parentId: null,
        timestamp: "2026-08-02T23:13:31.892Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi" }],
          model: "claude-opus-5",
          usage: {
            input: 44128,
            output: 195,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 44323,
            cost: { input: 0.22064, output: 0.004875, cacheRead: 0, cacheWrite: 0, total: 0.225515 },
          },
        },
      }),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0, source: "omp" });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toEqual({
      source: "omp",
      model: "claude-opus-5",
      timestamp: "2026-08-02T23:13:31.892Z",
      tokens: {
        inputTokens: 44128,
        cachedInputTokens: 0,
        outputTokens: 195,
        reasoningOutputTokens: 0,
      },
    });
  });

  it("skips non-assistant messages", async () => {
    const filePath = join(testDir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "test",
        timestamp: "2026-04-07T04:41:54.637Z",
      }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        parentId: null,
        timestamp: "2026-04-07T04:42:25.493Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          timestamp: 1775536945492,
        },
      }),
      JSON.stringify({
        type: "model_change",
        id: "mc1",
        timestamp: "2026-04-07T04:41:55.864Z",
        provider: "anthropic",
        modelId: "claude-sonnet-4",
      }),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("resumes from byte offset", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line1 = JSON.stringify({
      type: "message",
      id: "msg1",
      parentId: null,
      timestamp: "2026-04-07T04:42:45.105Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6-1m",
        content: [],
        usage: { input: 3, output: 100, cacheRead: 0, cacheWrite: 1000 },
      },
    });
    const line2 = JSON.stringify({
      type: "message",
      id: "msg2",
      parentId: "msg1",
      timestamp: "2026-04-07T04:43:00.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6-1m",
        content: [],
        usage: { input: 5, output: 200, cacheRead: 500, cacheWrite: 2000 },
      },
    });
    await writeFile(filePath, `${line1}\n${line2}\n`);

    // First parse — get both
    const result1 = await parsePiFile({ filePath, startOffset: 0 });
    expect(result1.deltas).toHaveLength(2);

    // Resume — get nothing new
    const result2 = await parsePiFile({
      filePath,
      startOffset: result1.endOffset,
    });
    expect(result2.deltas).toHaveLength(0);
    expect(result2.endOffset).toBe(result1.endOffset);
  });

  it("skips messages with zero usage", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      id: "msg1",
      parentId: null,
      timestamp: "2026-04-07T04:42:45.105Z",
      message: {
        role: "assistant",
        model: "some-model",
        content: [],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("skips messages without model", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      id: "msg1",
      parentId: null,
      timestamp: "2026-04-07T04:42:45.105Z",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 3, output: 100, cacheRead: 0, cacheWrite: 1000 },
      },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("handles multiple assistant messages across turns", async () => {
    const filePath = join(testDir, "session.jsonl");
    const messages = [
      {
        type: "message",
        id: "msg1",
        parentId: null,
        timestamp: "2026-04-07T04:42:45.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6-1m",
          content: [],
          usage: { input: 3, output: 135, cacheRead: 0, cacheWrite: 15521 },
        },
      },
      {
        type: "message",
        id: "msg2",
        parentId: "msg1",
        timestamp: "2026-04-07T04:42:50.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6-1m",
          content: [],
          usage: { input: 1, output: 99, cacheRead: 15521, cacheWrite: 1448 },
        },
      },
      {
        type: "message",
        id: "msg3",
        parentId: "msg2",
        timestamp: "2026-04-07T04:43:00.000Z",
        message: {
          role: "assistant",
          model: "gemini-3-pro-preview",
          content: [],
          usage: { input: 381, output: 89, cacheRead: 3199, cacheWrite: 0 },
        },
      },
    ];
    await writeFile(filePath, `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(3);

    // First message
    expect(result.deltas[0].source).toBe("pi");
    expect(result.deltas[0].model).toBe("claude-opus-4.6-1m");
    expect(result.deltas[0].tokens.inputTokens).toBe(3 + 15521);
    expect(result.deltas[0].tokens.outputTokens).toBe(135);

    // Third message — different model
    expect(result.deltas[2].model).toBe("gemini-3-pro-preview");
    expect(result.deltas[2].tokens.inputTokens).toBe(381 + 0);
    expect(result.deltas[2].tokens.cachedInputTokens).toBe(3199);
  });

  it("leaves a half-written trailing line unread and retries it after completion", async () => {
    const filePath = join(testDir, "session.jsonl");
    const complete = JSON.stringify({
      type: "message",
      id: "msg1",
      parentId: null,
      timestamp: "2026-04-07T04:42:45.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6-1m",
        content: [],
        usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
    });
    const second = JSON.stringify({
      type: "message",
      id: "msg2",
      parentId: "msg1",
      timestamp: "2026-04-07T04:42:50.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6-1m",
        content: [],
        usage: { input: 200, output: 20, cacheRead: 0, cacheWrite: 0 },
      },
    });

    // Writer flushed the first line plus half of the second
    const partial = second.slice(0, 40);
    await writeFile(filePath, `${complete}\n${partial}`);

    const first = await parsePiFile({ filePath, startOffset: 0 });
    expect(first.deltas).toHaveLength(1);
    // Cursor must stop after the last complete "\n", not at file size
    expect(first.endOffset).toBe(Buffer.byteLength(`${complete}\n`));

    // Writer completes the line — it must still be parsed
    await writeFile(filePath, `${complete}\n${second}\n`);
    const resumed = await parsePiFile({ filePath, startOffset: first.endOffset });
    expect(resumed.deltas).toHaveLength(1);
    expect(resumed.deltas[0].tokens.inputTokens).toBe(200);
    expect(resumed.endOffset).toBe(Buffer.byteLength(`${complete}\n${second}\n`));
  });

  it("does not replay lines appended after its stat snapshot", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = (id: string, input: number) =>
      JSON.stringify({
        type: "message",
        id,
        parentId: null,
        timestamp: "2026-04-07T04:42:45.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6-1m",
          content: [],
          usage: { input, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
      });

    const first = `${line("msg1", 100)}\n`;
    await writeFile(filePath, first);

    // Pin the interleaving: the append runs after the parser's stat() has
    // captured its snapshot but before it opens the stream. Racing an append
    // against the stat would make this test flaky in exactly the direction
    // that hides the bug.
    const appended = `${line("msg2", 200)}\n`;
    statGate.afterStat = () => appendFile(filePath, appended);
    const round1 = await parsePiFile({ filePath, startOffset: 0 });
    expect(statGate.afterStat).toBeNull(); // hook fired

    // The appended line was outside the snapshot: not parsed, not counted.
    expect(round1.endOffset).toBe(Buffer.byteLength(first));
    expect(round1.deltas.map((d) => d.tokens.inputTokens)).toEqual([100]);

    // Next round picks it up exactly once.
    const round2 = await parsePiFile({ filePath, startOffset: round1.endOffset });
    expect(round2.deltas.map((d) => d.tokens.inputTokens)).toEqual([200]);
  });

  it("returns empty for missing file", async () => {
    const result = await parsePiFile({
      filePath: join(testDir, "nonexistent.jsonl"),
      startOffset: 0,
    });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("handles malformed JSON lines gracefully", async () => {
    const filePath = join(testDir, "session.jsonl");
    const validLine = JSON.stringify({
      type: "message",
      id: "msg1",
      parentId: null,
      timestamp: "2026-04-07T04:42:45.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6-1m",
        content: [],
        usage: { input: 3, output: 100, cacheRead: 0, cacheWrite: 1000 },
      },
    });
    await writeFile(filePath, `not valid json\n${validLine}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("claude-opus-4.6-1m");
  });

  it("skips entries with non-string timestamp", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      id: "msg1",
      timestamp: 12345,
      message: {
        role: "assistant",
        model: "claude-opus-4.6-1m",
        content: [],
        usage: { input: 3, output: 100, cacheRead: 0, cacheWrite: 1000 },
      },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("skips entries with non-object usage", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      id: "msg1",
      timestamp: "2026-04-07T04:42:45.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6-1m",
        content: [],
        usage: "not an object",
      },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("skips entries with non-string model", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      id: "msg1",
      timestamp: "2026-04-07T04:42:45.000Z",
      message: {
        role: "assistant",
        model: 123,
        content: [],
        usage: { input: 3, output: 100, cacheRead: 0, cacheWrite: 1000 },
      },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("skips entries with empty model string", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      id: "msg1",
      timestamp: "2026-04-07T04:42:45.000Z",
      message: {
        role: "assistant",
        model: "  ",
        content: [],
        usage: { input: 3, output: 100, cacheRead: 0, cacheWrite: 1000 },
      },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("skips non-message type entries", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "session",
      id: "sess1",
      timestamp: "2026-04-07T04:42:45.000Z",
      usage: { input: 3, output: 100 },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("skips entries with no message field", async () => {
    const filePath = join(testDir, "session.jsonl");
    const line = JSON.stringify({
      type: "message",
      id: "msg1",
      timestamp: "2026-04-07T04:42:45.000Z",
      usage: { input: 3, output: 100 },
    });
    await writeFile(filePath, `${line}\n`);

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });
});

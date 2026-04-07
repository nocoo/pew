import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, stat } from "node:fs/promises";
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
    await writeFile(filePath, lines.join("\n") + "\n");

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
    await writeFile(filePath, lines.join("\n") + "\n");

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
    await writeFile(filePath, line1 + "\n" + line2 + "\n");

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
    await writeFile(filePath, line + "\n");

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
    await writeFile(filePath, line + "\n");

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
    await writeFile(filePath, messages.map((m) => JSON.stringify(m)).join("\n") + "\n");

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
    await writeFile(filePath, "not valid json\n" + validLine + "\n");

    const result = await parsePiFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("claude-opus-4.6-1m");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOpenClawFile } from "../parsers/openclaw.js";

/** Helper: create an OpenClaw JSONL line with usage */
function openclawLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message",
    timestamp: "2026-03-07T10:15:00.000Z",
    message: {
      model: "claude-sonnet-4",
      usage: {
        input: 5000,
        cacheRead: 1000,
        cacheWrite: 200,
        output: 800,
        totalTokens: 7000,
      },
    },
    ...overrides,
  });
}

describe("parseOpenClawFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-openclaw-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should parse a message with usage", async () => {
    const filePath = join(tempDir, "session.jsonl");
    await writeFile(filePath, openclawLine() + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("openclaw");
    expect(result.deltas[0].model).toBe("claude-sonnet-4");
    expect(result.deltas[0].tokens.inputTokens).toBe(6200); // input + cacheRead + cacheWrite
    expect(result.deltas[0].tokens.cachedInputTokens).toBe(1000); // cacheRead only
    expect(result.deltas[0].tokens.outputTokens).toBe(800);
    expect(result.deltas[0].tokens.reasoningOutputTokens).toBe(0);
    expect(result.endOffset).toBeGreaterThan(0);
  });

  it("should skip non-message types", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      JSON.stringify({ type: "system", content: "init" }),
      openclawLine(),
      JSON.stringify({ type: "tool", name: "bash" }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should skip empty lines and malformed JSON", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      "",
      "not valid json but has \"usage\" and totalTokens",
      openclawLine(),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should resume from byte offset", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const line1 = openclawLine({ timestamp: "2026-03-07T10:00:00.000Z" });
    const line2 = openclawLine({ timestamp: "2026-03-07T10:30:00.000Z" });
    await writeFile(filePath, line1 + "\n" + line2 + "\n");

    const r1 = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(r1.deltas).toHaveLength(2);

    const r2 = await parseOpenClawFile({ filePath, startOffset: r1.endOffset });
    expect(r2.deltas).toHaveLength(0);
  });

  it("should handle missing file", async () => {
    const result = await parseOpenClawFile({
      filePath: join(tempDir, "nope.jsonl"),
      startOffset: 0,
    });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("should skip zero-usage events", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const zeroLine = JSON.stringify({
      type: "message",
      timestamp: "2026-03-07T10:00:00.000Z",
      message: {
        model: "test",
        usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, totalTokens: 0 },
      },
    });
    await writeFile(filePath, zeroLine + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("should skip lines missing timestamp", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const noTs = JSON.stringify({
      type: "message",
      message: {
        model: "test",
        usage: { input: 100, output: 50, totalTokens: 150 },
      },
    });
    await writeFile(filePath, noTs + "\n" + openclawLine() + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should handle malformed JSON gracefully", async () => {
    const filePath = join(tempDir, "session.jsonl");
    await writeFile(filePath, "broken{{{ json\n" + openclawLine() + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should skip lines with usage keyword but invalid JSON containing totalTokens", async () => {
    const filePath = join(tempDir, "session.jsonl");
    // Line has "usage" and "totalTokens" text but is not valid JSON
    const badLine = '{"type":"message","usage":"broken","totalTokens":invalid}';
    await writeFile(filePath, badLine + "\n" + openclawLine() + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should skip lines where message is missing", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const noMsg = JSON.stringify({
      type: "message",
      timestamp: "2026-03-07T10:00:00.000Z",
      // message field missing, but usage/totalTokens in other places won't match fast-path
    });
    // But we need the fast-path to pass, so embed usage+totalTokens in a way that parses
    const noMsgWithKeywords = JSON.stringify({
      type: "message",
      timestamp: "2026-03-07T10:00:00.000Z",
      message: null,
      usage: { totalTokens: 100 },
    });
    await writeFile(filePath, noMsgWithKeywords + "\n" + openclawLine() + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1); // only the valid line
  });

  it("should skip lines where message.usage is missing", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const noUsage = JSON.stringify({
      type: "message",
      timestamp: "2026-03-07T10:00:00.000Z",
      message: { model: "test", totalTokens: 100 },
      usage: { totalTokens: 100 }, // top-level to pass fast-path
    });
    await writeFile(filePath, noUsage + "\n" + openclawLine() + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should use 'unknown' when model is missing from message", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const noModel = JSON.stringify({
      type: "message",
      timestamp: "2026-03-07T10:00:00.000Z",
      message: {
        // no model field
        usage: {
          input: 100,
          cacheRead: 0,
          cacheWrite: 0,
          output: 50,
          totalTokens: 150,
        },
      },
    });
    await writeFile(filePath, noModel + "\n");

    const result = await parseOpenClawFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("unknown");
  });
});

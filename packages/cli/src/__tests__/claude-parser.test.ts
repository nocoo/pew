import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeFile, normalizeClaudeUsage } from "../parsers/claude.js";

/** Helper: create a Claude-style JSONL line */
function claudeLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-03-07T10:15:30.000Z",
    sessionId: "ses-001",
    message: {
      id: "msg_001",
      type: "message",
      role: "assistant",
      model: "glm-5",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 5000,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 2000,
        output_tokens: 800,
      },
    },
    ...overrides,
  });
}

/** Helper: non-usage line (user message) */
function userLine(): string {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-03-07T10:15:00.000Z",
    message: { role: "user", content: "Hello" },
  });
}

/** Helper: streaming chunk (zero usage) */
function streamingChunk(): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-03-07T10:15:25.000Z",
    message: {
      id: "msg_001",
      type: "message",
      role: "assistant",
      model: "glm-5",
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
}

describe("normalizeClaudeUsage", () => {
  it("should normalize standard usage fields", () => {
    const delta = normalizeClaudeUsage({
      input_tokens: 5000,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 2000,
      output_tokens: 800,
    });
    expect(delta.inputTokens).toBe(5100); // input + cache_creation
    expect(delta.cachedInputTokens).toBe(2000);
    expect(delta.outputTokens).toBe(800);
    expect(delta.reasoningOutputTokens).toBe(0);
  });

  it("should handle missing cache fields", () => {
    const delta = normalizeClaudeUsage({
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(delta.inputTokens).toBe(1000);
    expect(delta.cachedInputTokens).toBe(0);
  });

  it("should handle zero usage (streaming chunks)", () => {
    const delta = normalizeClaudeUsage({
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(delta.inputTokens).toBe(0);
    expect(delta.outputTokens).toBe(0);
  });

  it("should coerce non-numeric values to 0", () => {
    const delta = normalizeClaudeUsage({
      input_tokens: "not a number",
      output_tokens: null,
    });
    expect(delta.inputTokens).toBe(0);
    expect(delta.outputTokens).toBe(0);
  });

  it("should coerce negative values to 0", () => {
    const delta = normalizeClaudeUsage({
      input_tokens: -100,
      output_tokens: -50,
    });
    expect(delta.inputTokens).toBe(0);
    expect(delta.outputTokens).toBe(0);
  });
});

describe("parseClaudeFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-claude-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("falls back to top-level obj.usage when message.usage is absent", async () => {
    // Exercises the `msg?.usage || obj?.usage` right-hand branch.
    const filePath = join(tempDir, "session-toplevel-usage.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-07T10:15:30.000Z",
      // No `message.usage` here — usage lives at the top level.
      message: { id: "msg_top", role: "assistant", model: "glm-5", type: "message" },
      usage: { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 10 },
    });
    await writeFile(filePath, line + "\n");
    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.outputTokens).toBe(50);
  });

  it("should parse a single assistant message with usage", async () => {
    const filePath = join(tempDir, "session.jsonl");
    await writeFile(filePath, claudeLine() + "\n");

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("claude-code");
    expect(result.deltas[0].model).toBe("glm-5");
    expect(result.deltas[0].tokens.inputTokens).toBe(5100);
    expect(result.deltas[0].tokens.cachedInputTokens).toBe(2000);
    expect(result.deltas[0].tokens.outputTokens).toBe(800);
    expect(result.deltas[0].timestamp).toBe("2026-03-07T10:15:30.000Z");
    expect(result.endOffset).toBeGreaterThan(0);
  });

  it("should skip non-usage lines", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const content = [userLine(), claudeLine(), userLine()].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should skip streaming chunks (all-zero usage)", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const content = [streamingChunk(), claudeLine()].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(5100);
  });

  it("should resume from byte offset", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const line1 = claudeLine({ timestamp: "2026-03-07T10:00:00.000Z" });
    const line2 = claudeLine({ timestamp: "2026-03-07T10:30:00.000Z" });
    const content = line1 + "\n" + line2 + "\n";
    await writeFile(filePath, content);

    // First read: get both lines
    const result1 = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result1.deltas).toHaveLength(2);

    // Second read: nothing new
    const result2 = await parseClaudeFile({
      filePath,
      startOffset: result1.endOffset,
    });
    expect(result2.deltas).toHaveLength(0);
    expect(result2.endOffset).toBe(result1.endOffset);
  });

  it("should pick up new content appended after offset", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const line1 = claudeLine({ timestamp: "2026-03-07T10:00:00.000Z" });
    await writeFile(filePath, line1 + "\n");

    const result1 = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result1.deltas).toHaveLength(1);

    // Append new content
    const line2 = claudeLine({ timestamp: "2026-03-07T10:30:00.000Z" });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(filePath, line2 + "\n");

    const result2 = await parseClaudeFile({
      filePath,
      startOffset: result1.endOffset,
    });
    expect(result2.deltas).toHaveLength(1);
    expect(result2.deltas[0].timestamp).toBe("2026-03-07T10:30:00.000Z");
  });

  it("should handle empty file", async () => {
    const filePath = join(tempDir, "empty.jsonl");
    await writeFile(filePath, "");

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("should handle missing file", async () => {
    const result = await parseClaudeFile({
      filePath: join(tempDir, "nonexistent.jsonl"),
      startOffset: 0,
    });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("should skip malformed JSON lines gracefully", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const content = [
      "not valid json{{{",
      claudeLine(),
      '{"broken": true, "usage": "fake"',
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should skip lines missing timestamp", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const noTimestamp = JSON.stringify({
      type: "assistant",
      message: {
        model: "glm-5",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    const content = [noTimestamp, claudeLine()].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("should parse multiple usage events from different models", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const line1 = claudeLine();
    const line2 = JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-07T10:20:00.000Z",
      message: {
        model: "glm-4.7",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 3000,
          output_tokens: 400,
        },
      },
    });
    const content = [line1, line2].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].model).toBe("glm-5");
    expect(result.deltas[1].model).toBe("glm-4.7");
  });

  it("should skip lines where model is missing from both message and top-level", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const noModel = JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-07T10:15:30.000Z",
      message: {
        // no model field
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      },
    });
    const content = [noModel, claudeLine()].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    // First line skipped (no model), second line parsed
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("glm-5");
  });

  it("should extract model from top-level obj when message.model is missing", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const topLevelModel = JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-07T10:15:30.000Z",
      model: "top-level-model",
      message: {
        // no model field here
        usage: {
          input_tokens: 200,
          output_tokens: 100,
        },
      },
    });
    await writeFile(filePath, topLevelModel + "\n");

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("top-level-model");
  });

  it("should skip lines where usage is not an object", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const badUsage = JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-07T10:15:30.000Z",
      message: {
        model: "glm-5",
        usage: "not-an-object",
      },
    });
    const content = [badUsage, claudeLine()].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });
});

describe("parseClaudeFile — message.id dedup", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-claude-dedup-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("dedups repeated message.id within a single file", async () => {
    // Claude Code can write the same assistant message multiple times
    // when a streaming request retries or a session is resumed. Same
    // message.id at different byte offsets must count only once.
    const filePath = join(tempDir, "session.jsonl");
    const line1 = claudeLine({ timestamp: "2026-03-07T10:00:00.000Z" });
    const line2 = claudeLine({ timestamp: "2026-03-07T10:00:00.001Z" });
    // Both use the default id "msg_001" from claudeLine()
    await writeFile(filePath, line1 + "\n" + line2 + "\n");

    const seen = new Set<string>();
    const result = await parseClaudeFile({
      filePath,
      startOffset: 0,
      seenMessageIds: seen,
    });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(5100);
    expect(seen.has("msg_001")).toBe(true);
  });

  it("counts distinct message.ids separately", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const line1 = claudeLine({
      timestamp: "2026-03-07T10:00:00.000Z",
      message: {
        id: "msg_A",
        model: "glm-5",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    const line2 = claudeLine({
      timestamp: "2026-03-07T10:01:00.000Z",
      message: {
        id: "msg_B",
        model: "glm-5",
        usage: { input_tokens: 200, output_tokens: 100 },
      },
    });
    await writeFile(filePath, line1 + "\n" + line2 + "\n");

    const seen = new Set<string>();
    const result = await parseClaudeFile({
      filePath,
      startOffset: 0,
      seenMessageIds: seen,
    });
    expect(result.deltas).toHaveLength(2);
    expect(seen.has("msg_A")).toBe(true);
    expect(seen.has("msg_B")).toBe(true);
  });

  it("dedups across files when the same Set is shared", async () => {
    const fileA = join(tempDir, "sessionA.jsonl");
    const fileB = join(tempDir, "sessionB.jsonl");
    await writeFile(fileA, claudeLine() + "\n");
    await writeFile(fileB, claudeLine({ timestamp: "2026-03-07T11:00:00.000Z" }) + "\n");

    const seen = new Set<string>();
    const rA = await parseClaudeFile({ filePath: fileA, startOffset: 0, seenMessageIds: seen });
    const rB = await parseClaudeFile({ filePath: fileB, startOffset: 0, seenMessageIds: seen });

    expect(rA.deltas).toHaveLength(1);
    expect(rB.deltas).toHaveLength(0); // dedup by shared Set
  });

  it("preserves lines missing message.id (no id → no dedup, always kept)", async () => {
    const filePath = join(tempDir, "session.jsonl");
    // Two lines that both lack message.id — neither should be dedup'd out.
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-07T10:15:30.000Z",
      message: {
        model: "glm-5",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    await writeFile(filePath, line + "\n" + line + "\n");

    const seen = new Set<string>();
    const result = await parseClaudeFile({
      filePath,
      startOffset: 0,
      seenMessageIds: seen,
    });
    // Without an id we cannot dedup — both must be kept to avoid data loss.
    expect(result.deltas).toHaveLength(2);
  });

  it("is backwards compatible when seenMessageIds is omitted", async () => {
    // Pre-existing callers that don't pass a Set get the old behavior:
    // every usage line counted, no dedup. This guarantees no other caller
    // silently changes behavior when the new parameter is added.
    const filePath = join(tempDir, "session.jsonl");
    await writeFile(filePath, claudeLine() + "\n" + claudeLine() + "\n");

    const result = await parseClaudeFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(2);
  });
});

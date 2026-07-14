import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodexFile } from "../parsers/codex.js";
import type { TokenDelta } from "@pew/core";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function sessionMeta(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2026-03-09T10:00:00.000Z",
    type: "session_meta",
    payload: {
      id: "test-session-id",
      timestamp: "2026-03-09T10:00:00.000Z",
      cwd: "/tmp/project",
      originator: "codex_exec",
      cli_version: "0.111.0",
      model_provider: "openai",
      ...overrides,
    },
  });
}

function turnContext(model: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2026-03-09T10:00:01.000Z",
    type: "turn_context",
    payload: {
      turn_id: "test-turn-id",
      cwd: "/tmp/project",
      model,
      ...overrides,
    },
  });
}

function tokenCount(
  total: Partial<TokenDelta & { total_tokens: number }>,
  timestamp = "2026-03-09T10:00:05.000Z",
): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: total.inputTokens ?? 0,
          cached_input_tokens: total.cachedInputTokens ?? 0,
          output_tokens: total.outputTokens ?? 0,
          reasoning_output_tokens: total.reasoningOutputTokens ?? 0,
          total_tokens: total.total_tokens ?? 0,
        },
      },
    },
  });
}

function responseItem(role: string): string {
  return JSON.stringify({
    timestamp: "2026-03-09T10:00:03.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: "output_text", text: "hello" }],
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseCodexFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-codex-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should parse a single token_count event with turn_context model", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      sessionMeta(),
      turnContext("gpt-5.4"),
      responseItem("user"),
      tokenCount({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 300, reasoningOutputTokens: 50 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("codex");
    expect(result.deltas[0].model).toBe("gpt-5.4");
    expect(result.deltas[0].timestamp).toBe("2026-03-09T10:00:05.000Z");
    // Emitted deltas are disjoint (cache ⊆ input, reasoning ⊆ output).
    // lastTotals stays raw OpenAI-shaped for resume diffs.
    expect(result.deltas[0].tokens).toEqual({
      inputTokens: 800,
      cachedInputTokens: 200,
      outputTokens: 250,
      reasoningOutputTokens: 50,
    });
    expect(result.lastTotals).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 300,
      reasoningOutputTokens: 50,
    });
    expect(result.lastModel).toBe("gpt-5.4");
  });

  it("should compute diffs between consecutive token_count events", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      tokenCount({ inputTokens: 1000, outputTokens: 200 }, "2026-03-09T10:00:05.000Z"),
      tokenCount({ inputTokens: 2500, outputTokens: 500 }, "2026-03-09T10:00:10.000Z"),
      tokenCount({ inputTokens: 4000, outputTokens: 800 }, "2026-03-09T10:00:15.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(3);

    // First: absolute (no previous totals)
    expect(result.deltas[0].tokens.inputTokens).toBe(1000);
    expect(result.deltas[0].tokens.outputTokens).toBe(200);

    // Second: diff from first
    expect(result.deltas[1].tokens.inputTokens).toBe(1500);
    expect(result.deltas[1].tokens.outputTokens).toBe(300);

    // Third: diff from second
    expect(result.deltas[2].tokens.inputTokens).toBe(1500);
    expect(result.deltas[2].tokens.outputTokens).toBe(300);
  });

  it("should resume from byte offset with lastTotals", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      tokenCount({ inputTokens: 1000, outputTokens: 200 }, "2026-03-09T10:00:05.000Z"),
      tokenCount({ inputTokens: 2500, outputTokens: 500 }, "2026-03-09T10:00:10.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const r1 = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(r1.deltas).toHaveLength(2);

    // Append more data
    const newLines = [
      tokenCount({ inputTokens: 4000, outputTokens: 800 }, "2026-03-09T10:00:15.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n${newLines.join("\n")}\n`);

    const r2 = await parseCodexFile({
      filePath,
      startOffset: r1.endOffset,
      lastTotals: r1.lastTotals,
      lastModel: r1.lastModel,
    });
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0].tokens.inputTokens).toBe(1500); // 4000 - 2500
    expect(r2.deltas[0].tokens.outputTokens).toBe(300); // 800 - 500
    expect(r2.deltas[0].model).toBe("gpt-5.4");
  });

  it("should use model from session_meta when turn_context is absent", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      sessionMeta({ model: "gpt-5.3-codex" }),
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("gpt-5.3-codex");
  });

  it("should prefer turn_context model over session_meta model", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      sessionMeta({ model: "gpt-5.3-codex" }),
      turnContext("gpt-5.4"),
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas[0].model).toBe("gpt-5.4");
  });

  it("ignores turn_context with non-string model and retains existing lastModel", async () => {
    // Exercises the `typeof payload.model === "string" ? ... : null` false branch.
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      sessionMeta({ model: "gpt-5.3-codex" }),
      turnContext("gpt-5.4", { model: 42 }), // override to a non-string
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);
    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    // turn_context with non-string model is ignored → session_meta model is retained.
    expect(result.deltas[0].model).toBe("gpt-5.3-codex");
  });

  it("should use lastModel when resuming mid-file with no new model info", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      tokenCount({ inputTokens: 5000, outputTokens: 1000 }, "2026-03-09T10:00:15.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({
      filePath,
      startOffset: 0,
      lastTotals: { inputTokens: 3000, cachedInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 0 },
      lastModel: "gpt-5.4",
    });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("gpt-5.4");
    expect(result.deltas[0].tokens.inputTokens).toBe(2000);
  });

  it("should use 'unknown' when no model is available", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("unknown");
  });

  it("should skip zero deltas (no change from previous totals)", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      tokenCount({ inputTokens: 1000, outputTokens: 200 }, "2026-03-09T10:00:05.000Z"),
      // Same totals → zero delta → should be skipped
      tokenCount({ inputTokens: 1000, outputTokens: 200 }, "2026-03-09T10:00:06.000Z"),
      // New totals → non-zero delta
      tokenCount({ inputTokens: 2000, outputTokens: 400 }, "2026-03-09T10:00:10.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(2);
  });

  it("should handle missing file gracefully", async () => {
    const result = await parseCodexFile({
      filePath: join(tempDir, "nope.jsonl"),
      startOffset: 0,
      lastTotals: null,
      lastModel: null,
    });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("should handle malformed JSON gracefully", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      "broken{{{ json",
      turnContext("gpt-5.4"),
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(500);
  });

  it("should skip non-token_count event_msg types", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      // task_started event — should be skipped
      JSON.stringify({
        timestamp: "2026-03-09T10:00:02.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "test" },
      }),
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
  });

  it("should handle negative diffs (counter reset) by clamping to zero", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      // Simulating a counter reset: new totals lower than previous
      tokenCount({ inputTokens: 100, outputTokens: 50 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({
      filePath,
      startOffset: 0,
      lastTotals: { inputTokens: 500, cachedInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 0 },
      lastModel: "gpt-5.4",
    });
    // Should treat as absolute (counter reset)
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(100);
    expect(result.deltas[0].tokens.outputTokens).toBe(50);
  });

  it("should return no deltas when file is at startOffset already", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    await writeFile(filePath, `${tokenCount({ inputTokens: 500, outputTokens: 100 })}\n`);

    const r1 = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    const r2 = await parseCodexFile({
      filePath,
      startOffset: r1.endOffset,
      lastTotals: r1.lastTotals,
      lastModel: r1.lastModel,
    });
    expect(r2.deltas).toHaveLength(0);
  });

  it("should track all four token fields in diffs", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      tokenCount(
        { inputTokens: 1000, cachedInputTokens: 300, outputTokens: 200, reasoningOutputTokens: 50 },
        "2026-03-09T10:00:05.000Z",
      ),
      tokenCount(
        { inputTokens: 2500, cachedInputTokens: 800, outputTokens: 600, reasoningOutputTokens: 150 },
        "2026-03-09T10:00:10.000Z",
      ),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    // raw delta: in=1500 cached=500 out=400 rea=100
    // disjoint: in=1000 cached=500 out=300 rea=100
    expect(result.deltas[1].tokens).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 300,
      reasoningOutputTokens: 100,
    });
    // first event also normalized
    expect(result.deltas[0].tokens).toEqual({
      inputTokens: 700,
      cachedInputTokens: 300,
      outputTokens: 150,
      reasoningOutputTokens: 50,
    });
    // cursor keeps raw inclusive totals
    expect(result.lastTotals).toEqual({
      inputTokens: 2500,
      cachedInputTokens: 800,
      outputTokens: 600,
      reasoningOutputTokens: 150,
    });
  });

  it("should handle empty file", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    await writeFile(filePath, "");

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("should handle multiple model changes via turn_context", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      tokenCount({ inputTokens: 1000, outputTokens: 200 }, "2026-03-09T10:00:05.000Z"),
      turnContext("o3"),
      tokenCount({ inputTokens: 2000, outputTokens: 500 }, "2026-03-09T10:01:00.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].model).toBe("gpt-5.4");
    expect(result.deltas[1].model).toBe("o3");
    expect(result.lastModel).toBe("o3");
  });

  it("should skip token_count events without timestamp", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      // token_count event without timestamp field
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 500, output_tokens: 100 },
          },
        },
      }),
      // Valid token_count with timestamp
      tokenCount({ inputTokens: 1000, outputTokens: 200 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(1000);
  });

  it("should skip token_count events without info field", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      JSON.stringify({
        timestamp: "2026-03-09T10:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          // missing info field
        },
      }),
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:10.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(500);
  });

  it("should skip token_count events without total_token_usage field", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      JSON.stringify({
        timestamp: "2026-03-09T10:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            // missing total_token_usage
            some_other_field: 123,
          },
        },
      }),
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:10.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(500);
  });

  it("should ignore turn_context with empty model string", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      sessionMeta({ model: "gpt-5.3-codex" }),
      // turn_context with empty model — should NOT override session_meta
      turnContext("   "), // whitespace only, trims to empty
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("gpt-5.3-codex");
  });

  it("should skip empty lines in JSONL", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      "", // empty line
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
      "", // another empty line
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(500);
  });

  it("should skip JSON objects without valid type string", async () => {
    const filePath = join(tempDir, "rollout.jsonl");
    const lines = [
      turnContext("gpt-5.4"),
      // Objects without valid type field
      JSON.stringify({ timestamp: "2026-03-09T10:00:02.000Z", type: null }),
      JSON.stringify({ timestamp: "2026-03-09T10:00:03.000Z", type: 123 }),
      JSON.stringify({ timestamp: "2026-03-09T10:00:04.000Z" }), // no type field
      tokenCount({ inputTokens: 500, outputTokens: 100 }, "2026-03-09T10:00:05.000Z"),
    ];
    await writeFile(filePath, `${lines.join("\n")}\n`);

    const result = await parseCodexFile({ filePath, startOffset: 0, lastTotals: null, lastModel: null });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(500);
  });
});

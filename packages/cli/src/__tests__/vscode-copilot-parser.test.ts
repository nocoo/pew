import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVscodeCopilotFile,
  type VscodeCopilotParseOpts,
  type VscodeCopilotFileResult,
  type SkipInfo,
} from "../parsers/vscode-copilot.js";

// ---------------------------------------------------------------------------
// CRDT line helpers
// ---------------------------------------------------------------------------

/** kind=0 snapshot with requests array */
function snapshotLine(requests: unknown[] = []): string {
  return JSON.stringify({
    kind: 0,
    v: { requests },
  });
}

/** kind=2 append request to ["requests"] */
function appendRequestLine(request: Record<string, unknown>): string {
  return JSON.stringify({
    kind: 2,
    k: ["requests"],
    v: [request],
  });
}

/** kind=1 set result at ["requests", index, "result"] */
function setResultLine(
  index: number,
  result: Record<string, unknown>,
): string {
  return JSON.stringify({
    kind: 1,
    k: ["requests", index, "result"],
    v: result,
  });
}

/** kind=2 append response content (should be ignored by parser) */
function appendResponseLine(index: number): string {
  return JSON.stringify({
    kind: 2,
    k: ["requests", index, "response"],
    v: [{ kind: "markdownContent", content: { value: "Some response text" } }],
  });
}

/** Build a complete result object with tokens */
function resultWithTokens(
  promptTokens: number,
  outputTokens: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    timings: { totalElapsed: 10000, firstProgress: 500 },
    details: "Claude Opus 4.6 • 3x",
    metadata: {
      promptTokens,
      outputTokens,
      agentId: "github.copilot.editsAgent",
      sessionId: "session-001",
      ...overrides,
    },
  };
}

/** Build a result object without token fields */
function resultWithoutTokens(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    timings: { totalElapsed: 538892, firstProgress: 8300 },
    metadata: {
      agentId: "github.copilot.editsAgent",
      sessionId: "session-001",
      ...overrides,
    },
  };
}

/** Build a standard request object */
function makeRequest(
  modelId: string,
  timestamp: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestId: `request_${timestamp}`,
    modelId,
    timestamp,
    message: { text: "Hello" },
    ...overrides,
  };
}

describe("parseVscodeCopilotFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-vscode-copilot-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Basic parsing
  // -----------------------------------------------------------------------

  it("should parse a single request with tokens from kind=2 + kind=1", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780377684)),
      appendResponseLine(0),
      setResultLine(0, resultWithTokens(36533, 937)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("vscode-copilot");
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
    expect(result.deltas[0].tokens.inputTokens).toBe(36533);
    expect(result.deltas[0].tokens.outputTokens).toBe(937);
    expect(result.deltas[0].tokens.cachedInputTokens).toBe(0);
    expect(result.deltas[0].tokens.reasoningOutputTokens).toBe(0);
    expect(result.deltas[0].timestamp).toBeTruthy();
    expect(result.endOffset).toBeGreaterThan(0);
    expect(result.processedRequestIndices).toEqual([0]);
    expect(result.requestMeta[0]).toEqual({
      modelId: "claude-opus-4.6",
      timestamp: 1772780377684,
    });
  });

  it("should parse requests from kind=0 snapshot with pre-existing requests", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine([
        makeRequest("copilot/claude-opus-4.6", 1772780000000),
        makeRequest("copilot/claude-opus-4.6-1m", 1772780100000),
      ]),
      setResultLine(0, resultWithTokens(10000, 500)),
      setResultLine(1, resultWithTokens(20000, 1000)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
    expect(result.deltas[0].tokens.inputTokens).toBe(10000);
    expect(result.deltas[1].model).toBe("claude-opus-4.6-1m");
    expect(result.deltas[1].tokens.inputTokens).toBe(20000);
    expect(result.processedRequestIndices).toEqual([0, 1]);
  });

  it("should parse multiple requests from kind=2 appends", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, resultWithTokens(10000, 500)),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780100000)),
      setResultLine(1, resultWithTokens(20000, 1000)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].tokens.inputTokens).toBe(10000);
    expect(result.deltas[1].tokens.inputTokens).toBe(20000);
  });

  // -----------------------------------------------------------------------
  // Model ID normalization
  // -----------------------------------------------------------------------

  it("should strip copilot/ prefix from model ID", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6-1m", 1772780000000)),
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas[0].model).toBe("claude-opus-4.6-1m");
  });

  it("should keep model ID as-is when no copilot/ prefix", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("gpt-4o", 1772780000000)),
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas[0].model).toBe("gpt-4o");
  });

  // -----------------------------------------------------------------------
  // Skipping requests without tokens
  // -----------------------------------------------------------------------

  it("should skip requests without token fields in result", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780100000)),
      setResultLine(0, resultWithTokens(10000, 500)),
      setResultLine(1, resultWithoutTokens()),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(10000);
    // Both indices should be in processedRequestIndices (even skipped ones)
    expect(result.processedRequestIndices).toContain(0);
    expect(result.processedRequestIndices).toContain(1);
  });

  it("should skip requests with empty result {}", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, {}),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(0);
    expect(result.processedRequestIndices).toContain(0);
  });

  // -----------------------------------------------------------------------
  // Incremental sync (byte-offset resume)
  // -----------------------------------------------------------------------

  it("should resume from byte offset and skip already-processed indices", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, resultWithTokens(10000, 500)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    // First parse
    const result1 = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result1.deltas).toHaveLength(1);

    // Append new request
    const newLines = [
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780200000)),
      setResultLine(1, resultWithTokens(30000, 2000)),
    ];
    await appendFile(filePath, newLines.join("\n") + "\n");

    // Resume with previous state
    const result2 = await parseVscodeCopilotFile({
      filePath,
      startOffset: result1.endOffset,
      requestMeta: result1.requestMeta,
      processedRequestIndices: result1.processedRequestIndices,
    });

    expect(result2.deltas).toHaveLength(1);
    expect(result2.deltas[0].tokens.inputTokens).toBe(30000);
    expect(result2.processedRequestIndices).toContain(0);
    expect(result2.processedRequestIndices).toContain(1);
  });

  it("should use persisted requestMeta for kind=1 result lines after resume", async () => {
    // Simulate: kind=2 request was before offset, kind=1 result is after offset
    const filePath = join(tempDir, "session.jsonl");

    // Initial file: snapshot + request append
    const initialLines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
    ];
    await writeFile(filePath, initialLines.join("\n") + "\n");

    // First parse: no result yet, just metadata
    const result1 = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result1.deltas).toHaveLength(0);
    expect(result1.requestMeta[0]).toEqual({
      modelId: "claude-opus-4.6",
      timestamp: 1772780000000,
    });

    // Append result line (after offset)
    await appendFile(filePath, setResultLine(0, resultWithTokens(15000, 800)) + "\n");

    // Resume: kind=1 references index 0 whose kind=2 is before offset,
    // but requestMeta is persisted from prior parse
    const result2 = await parseVscodeCopilotFile({
      filePath,
      startOffset: result1.endOffset,
      requestMeta: result1.requestMeta,
      processedRequestIndices: result1.processedRequestIndices,
    });

    expect(result2.deltas).toHaveLength(1);
    expect(result2.deltas[0].model).toBe("claude-opus-4.6");
    expect(result2.deltas[0].tokens.inputTokens).toBe(15000);
  });

  it("should not re-emit already processed request indices on re-read", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, resultWithTokens(10000, 500)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result1 = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    // Re-parse from beginning but with already-processed indices
    const result2 = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [0],
    });

    expect(result2.deltas).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("should handle empty file", async () => {
    const filePath = join(tempDir, "empty.jsonl");
    await writeFile(filePath, "");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("should handle missing file", async () => {
    const result = await parseVscodeCopilotFile({
      filePath: join(tempDir, "nonexistent.jsonl"),
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("should skip malformed JSON lines gracefully", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      "not valid json{{{",
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      '{"broken": true',
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(1);
  });

  it("should skip result line when request metadata is missing", async () => {
    const filePath = join(tempDir, "session.jsonl");
    // Result references index 0 but no kind=0/2 ever defined it
    const lines = [
      snapshotLine(),
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(0);
  });

  it("should ignore kind=2 appends to response paths", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      appendResponseLine(0),
      appendResponseLine(0),
      appendResponseLine(0),
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    // Should still only produce 1 delta (response appends are noise)
    expect(result.deltas).toHaveLength(1);
  });

  it("should handle kind=1 set on non-result paths without crashing", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      // kind=1 but sets "inputState" not "result"
      JSON.stringify({ kind: 1, k: ["requests", 0, "inputState"], v: { foo: "bar" } }),
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(1);
  });

  it("should handle zero-token results (skip them)", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, resultWithTokens(0, 0)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(0);
    expect(result.processedRequestIndices).toContain(0);
  });

  it("should convert timestamp from epoch ms to ISO 8601", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const ts = 1772780377684; // known epoch ms
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", ts)),
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas[0].timestamp).toBe(new Date(ts).toISOString());
  });

  it("should handle snapshot with both pre-existing and new requests", async () => {
    const filePath = join(tempDir, "session.jsonl");
    // Snapshot has 1 request already
    const lines = [
      snapshotLine([
        makeRequest("copilot/claude-opus-4.6", 1772780000000),
      ]),
      setResultLine(0, resultWithTokens(10000, 500)),
      // New request appended via kind=2
      appendRequestLine(makeRequest("copilot/claude-opus-4.6-1m", 1772780100000)),
      setResultLine(1, resultWithTokens(20000, 1000)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
    });

    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
    expect(result.deltas[1].model).toBe("claude-opus-4.6-1m");
  });

  // -----------------------------------------------------------------------
  // onSkip callback
  // -----------------------------------------------------------------------

  it("should call onSkip for zero-token results with modelState", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, resultWithTokens(0, 0, { modelState: 2 })),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const skips: SkipInfo[] = [];
    await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
      onSkip: (info) => skips.push(info),
    });

    expect(skips).toHaveLength(1);
    expect(skips[0].index).toBe(0);
    expect(skips[0].reason).toContain("zero tokens");
    expect(skips[0].modelState).toBe(2);
  });

  it("should call onSkip for missing metadata object in result", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, { timings: { totalElapsed: 100 } }), // no metadata field
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const skips: SkipInfo[] = [];
    await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
      onSkip: (info) => skips.push(info),
    });

    expect(skips).toHaveLength(1);
    expect(skips[0].index).toBe(0);
    expect(skips[0].reason).toContain("missing metadata");
  });

  it("should call onSkip for deferred result with no metadata", async () => {
    const filePath = join(tempDir, "session.jsonl");
    // Result references index 0 but no kind=0/2 ever defined it
    const lines = [
      snapshotLine(),
      setResultLine(0, resultWithTokens(5000, 300)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const skips: SkipInfo[] = [];
    await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
      onSkip: (info) => skips.push(info),
    });

    expect(skips).toHaveLength(1);
    expect(skips[0].index).toBe(0);
    expect(skips[0].reason).toContain("no request metadata");
    expect(skips[0].reason).toContain("deferred");
  });

  it("should not call onSkip for successfully parsed requests", async () => {
    const filePath = join(tempDir, "session.jsonl");
    const lines = [
      snapshotLine(),
      appendRequestLine(makeRequest("copilot/claude-opus-4.6", 1772780000000)),
      setResultLine(0, resultWithTokens(10000, 500)),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const skips: SkipInfo[] = [];
    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: 0,
      requestMeta: {},
      processedRequestIndices: [],
      onSkip: (info) => skips.push(info),
    });

    expect(result.deltas).toHaveLength(1);
    expect(skips).toHaveLength(0);
  });
});

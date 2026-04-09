import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVscodeCopilotV3File,
  type VscodeCopilotV3ParseOpts,
} from "../parsers/vscode-copilot-v3.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeV3Session(requests: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 3,
    responderUsername: "GitHub Copilot",
    initialLocation: "panel",
    requests,
    ...overrides,
  });
}

function makeV3Request(
  modelId: string,
  timestamp: number,
  promptTokens: number,
  outputTokens: number,
  overrides: Record<string, unknown> = {},
  toolCallRounds: unknown[] = [],
): Record<string, unknown> {
  return {
    requestId: `request_${timestamp}`,
    timestamp,
    modelId,
    result: {
      timings: { firstProgress: 1000, totalElapsed: 5000 },
      metadata: {
        promptTokens,
        outputTokens,
        toolCallRounds,
        renderedUserMessage: [],
        ...overrides,
      },
    },
  };
}

describe("parseVscodeCopilotV3File", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-vscode-v3-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should parse a single request with tokens", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6", 1775652693236, 36533, 937),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("vscode-copilot");
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
    expect(result.deltas[0].tokens.inputTokens).toBe(36533);
    expect(result.deltas[0].tokens.outputTokens).toBe(937);
    expect(result.deltas[0].tokens.cachedInputTokens).toBe(0);
    expect(result.deltas[0].tokens.reasoningOutputTokens).toBe(0);
    expect(result.deltas[0].timestamp).toBe(new Date(1775652693236).toISOString());
  });

  it("should parse multiple requests", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6", 1775652693236, 10000, 500),
      makeV3Request("copilot/gpt-4o", 1775652793236, 20000, 1000),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });

    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
    expect(result.deltas[1].model).toBe("gpt-4o");
  });

  it("should strip copilot/ prefix from model ID", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6-1m", 1775652693236, 5000, 300),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas[0].model).toBe("claude-opus-4.6-1m");
  });

  it("should keep model ID as-is when no copilot/ prefix", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      makeV3Request("gpt-4o", 1775652693236, 5000, 300),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas[0].model).toBe("gpt-4o");
  });

  it("should skip requests with zero tokens", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6", 1775652693236, 10000, 500),
      makeV3Request("copilot/claude-opus-4.6", 1775652793236, 0, 0),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(10000);
  });

  it("should skip requests without result", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      { requestId: "req_1", timestamp: 1775652693236, modelId: "copilot/gpt-4o" },
      makeV3Request("copilot/claude-opus-4.6", 1775652793236, 5000, 300),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
  });

  it("should skip requests without metadata in result", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      {
        requestId: "req_1",
        timestamp: 1775652693236,
        modelId: "copilot/gpt-4o",
        result: { timings: { totalElapsed: 1000 } },
      },
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(0);
  });

  it("should add tool args estimate to outputTokens", async () => {
    const filePath = join(tempDir, "session.json");
    const toolCallRounds = [
      { toolCalls: [{ name: "read_file", arguments: "a".repeat(800) }] },
    ];
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-sonnet-4.6", 1775652693236, 50000, 100, {}, toolCallRounds),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(1);
    // 100 + floor(800/4) = 300
    expect(result.deltas[0].tokens.outputTokens).toBe(300);
  });

  it("should add thinking text estimate to reasoningOutputTokens", async () => {
    const filePath = join(tempDir, "session.json");
    const toolCallRounds = [
      { thinking: { text: "t".repeat(1200), tokens: 0 } },
    ];
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6", 1775652693236, 30000, 50, {}, toolCallRounds),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.reasoningOutputTokens).toBe(300);
  });

  it("should handle empty requests array", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(0);
  });

  it("should handle missing file", async () => {
    const result = await parseVscodeCopilotV3File({
      filePath: join(tempDir, "nonexistent.json"),
    });
    expect(result.deltas).toHaveLength(0);
  });

  it("should handle invalid JSON", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, "not valid json{{{");

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(0);
  });

  it("should ignore non-v3 JSON files", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, JSON.stringify({ version: 2, data: [] }));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(0);
  });

  it("should not skip result with only tool args tokens", async () => {
    const filePath = join(tempDir, "session.json");
    const toolCallRounds = [
      { toolCalls: [{ name: "grep", arguments: "x".repeat(400) }] },
    ];
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-sonnet-4.6", 1775652693236, 0, 0, {}, toolCallRounds),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.outputTokens).toBe(100); // floor(400/4)
  });

  it("should skip requests without modelId", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      {
        requestId: "req_1",
        timestamp: 1775652693236,
        result: { metadata: { promptTokens: 100, outputTokens: 50 } },
      },
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(0);
  });

  it("should skip requests without timestamp", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      {
        requestId: "req_1",
        modelId: "copilot/gpt-4o",
        result: { metadata: { promptTokens: 100, outputTokens: 50 } },
      },
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.deltas).toHaveLength(0);
  });

  it("should return processedRequestIds for cursor persistence", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6", 1775652693236, 10000, 500),
      makeV3Request("copilot/gpt-4o", 1775652793236, 20000, 1000),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    expect(result.processedRequestIds).toHaveLength(2);
    expect(result.processedRequestIds).toContain("request_1775652693236");
    expect(result.processedRequestIds).toContain("request_1775652793236");
  });

  it("should skip already-processed requests on incremental sync", async () => {
    const filePath = join(tempDir, "session.json");

    // First sync: 1 request
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6", 1775652693236, 10000, 500),
    ]));
    const result1 = await parseVscodeCopilotV3File({ filePath });
    expect(result1.deltas).toHaveLength(1);
    expect(result1.processedRequestIds).toEqual(["request_1775652693236"]);

    // Second sync: file now has 2 requests, pass previous processedRequestIds
    await writeFile(filePath, makeV3Session([
      makeV3Request("copilot/claude-opus-4.6", 1775652693236, 10000, 500),
      makeV3Request("copilot/gpt-4o", 1775652793236, 20000, 1000),
    ]));
    const result2 = await parseVscodeCopilotV3File({
      filePath,
      processedRequestIds: new Set(result1.processedRequestIds),
    });

    // Should only return the NEW request, not the old one
    expect(result2.deltas).toHaveLength(1);
    expect(result2.deltas[0].model).toBe("gpt-4o");
    // processedRequestIds should include ALL seen requests
    expect(result2.processedRequestIds).toHaveLength(2);
    expect(result2.processedRequestIds).toContain("request_1775652693236");
    expect(result2.processedRequestIds).toContain("request_1775652793236");
  });

  it("should handle requests without requestId gracefully", async () => {
    const filePath = join(tempDir, "session.json");
    await writeFile(filePath, makeV3Session([
      {
        // No requestId
        timestamp: 1775652693236,
        modelId: "copilot/gpt-4o",
        result: { metadata: { promptTokens: 100, outputTokens: 50 } },
      },
      makeV3Request("copilot/claude-opus-4.6", 1775652793236, 5000, 300),
    ]));

    const result = await parseVscodeCopilotV3File({ filePath });
    // Should skip the request without ID but process the valid one
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
    expect(result.processedRequestIds).toEqual(["request_1775652793236"]);
  });

  it("should NOT mark incomplete request as processed (allows retry on next sync)", async () => {
    const filePath = join(tempDir, "session.json");

    // First sync: request exists but has no result yet (incomplete)
    await writeFile(filePath, makeV3Session([
      {
        requestId: "req_incomplete",
        timestamp: 1775652693236,
        modelId: "copilot/gpt-4o",
        // No result field - request is still in progress
      },
    ]));
    const result1 = await parseVscodeCopilotV3File({ filePath });
    expect(result1.deltas).toHaveLength(0);
    // Incomplete request should NOT be in processedRequestIds
    expect(result1.processedRequestIds).toEqual([]);

    // Second sync: same request now has complete result
    await writeFile(filePath, makeV3Session([
      {
        requestId: "req_incomplete",
        timestamp: 1775652693236,
        modelId: "copilot/gpt-4o",
        result: {
          metadata: { promptTokens: 5000, outputTokens: 300 },
        },
      },
    ]));
    const result2 = await parseVscodeCopilotV3File({
      filePath,
      processedRequestIds: new Set(result1.processedRequestIds),
    });

    // Now the request should be processed
    expect(result2.deltas).toHaveLength(1);
    expect(result2.deltas[0].tokens.inputTokens).toBe(5000);
    expect(result2.processedRequestIds).toEqual(["req_incomplete"]);
  });

  it("should NOT mark zero-token request as processed (allows retry on next sync)", async () => {
    const filePath = join(tempDir, "session.json");

    // First sync: request has result but with zero tokens
    await writeFile(filePath, makeV3Session([
      {
        requestId: "req_zero",
        timestamp: 1775652693236,
        modelId: "copilot/gpt-4o",
        result: {
          metadata: { promptTokens: 0, outputTokens: 0 },
        },
      },
    ]));
    const result1 = await parseVscodeCopilotV3File({ filePath });
    expect(result1.deltas).toHaveLength(0);
    // Zero-token request should NOT be in processedRequestIds
    expect(result1.processedRequestIds).toEqual([]);

    // Second sync: same request now has real tokens
    await writeFile(filePath, makeV3Session([
      {
        requestId: "req_zero",
        timestamp: 1775652693236,
        modelId: "copilot/gpt-4o",
        result: {
          metadata: { promptTokens: 8000, outputTokens: 500 },
        },
      },
    ]));
    const result2 = await parseVscodeCopilotV3File({
      filePath,
      processedRequestIds: new Set(result1.processedRequestIds),
    });

    // Now the request should be processed
    expect(result2.deltas).toHaveLength(1);
    expect(result2.deltas[0].tokens.inputTokens).toBe(8000);
    expect(result2.processedRequestIds).toEqual(["req_zero"]);
  });
});

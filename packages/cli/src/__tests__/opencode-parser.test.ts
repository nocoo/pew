import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseOpenCodeFile,
  normalizeOpenCodeTokens,
} from "../parsers/opencode.js";
import { coerceEpochMs } from "../utils/time.js";

/** Helper: create an OpenCode message JSON */
function opencodeMsg(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "msg_001",
    sessionID: "ses_001",
    role: "assistant",
    modelID: "claude-opus-4.6",
    providerID: "github-copilot",
    time: {
      created: 1771120749059,
      completed: 1771120822000,
    },
    tokens: {
      total: 15404,
      input: 14967,
      output: 437,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  });
}

describe("normalizeOpenCodeTokens", () => {
  it("should normalize standard opencode tokens", () => {
    const result = normalizeOpenCodeTokens({
      total: 15404,
      input: 14967,
      output: 437,
      reasoning: 0,
      cache: { read: 200, write: 100 },
    });
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(15067); // input + cache.write
    expect(result!.cachedInputTokens).toBe(200); // cache.read
    expect(result!.outputTokens).toBe(437);
    expect(result!.reasoningOutputTokens).toBe(0);
  });

  it("should handle reasoning tokens", () => {
    const result = normalizeOpenCodeTokens({
      total: 1000,
      input: 500,
      output: 300,
      reasoning: 200,
      cache: { read: 0, write: 0 },
    });
    expect(result).not.toBeNull();
    expect(result!.reasoningOutputTokens).toBe(200);
  });

  it("should return null for missing tokens", () => {
    expect(normalizeOpenCodeTokens(null)).toBeNull();
    expect(normalizeOpenCodeTokens(undefined)).toBeNull();
  });

  it("should handle missing cache object", () => {
    const result = normalizeOpenCodeTokens({
      total: 100,
      input: 80,
      output: 20,
      reasoning: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(80);
    expect(result!.cachedInputTokens).toBe(0);
  });
});

describe("parseOpenCodeFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-opencode-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should parse an assistant message with tokens", async () => {
    const filePath = join(tempDir, "msg_001.json");
    await writeFile(filePath, opencodeMsg());

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).not.toBeNull();
    expect(result.delta!.source).toBe("opencode");
    expect(result.delta!.model).toBe("claude-opus-4.6");
    expect(result.delta!.tokens.inputTokens).toBe(14967); // no cache.write
    expect(result.delta!.tokens.outputTokens).toBe(437);
    expect(result.messageKey).toBe("ses_001|msg_001");
  });

  it("should compute diff against previous totals", async () => {
    const filePath = join(tempDir, "msg_002.json");
    await writeFile(
      filePath,
      opencodeMsg({
        tokens: {
          total: 500,
          input: 300,
          output: 200,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    );

    const prevTotals = {
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 80,
      reasoningOutputTokens: 0,
    };

    const result = await parseOpenCodeFile({ filePath, lastTotals: prevTotals });
    expect(result.delta).not.toBeNull();
    expect(result.delta!.tokens.inputTokens).toBe(200); // 300 - 100
    expect(result.delta!.tokens.outputTokens).toBe(120); // 200 - 80
  });

  it("should handle epoch seconds (auto-coerce to ms)", async () => {
    const filePath = join(tempDir, "msg_epoch.json");
    // Epoch in seconds (< 1e12)
    await writeFile(
      filePath,
      opencodeMsg({
        time: { created: 1771120749, completed: 1771120822 },
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).not.toBeNull();
    expect(result.delta!.timestamp).toBeDefined();
  });

  it("should return null delta for user messages", async () => {
    const filePath = join(tempDir, "msg_user.json");
    await writeFile(filePath, JSON.stringify({
      id: "msg_user1",
      sessionID: "ses_001",
      role: "user",
      time: { created: 1771120749059 },
    }));

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).toBeNull();
  });

  it("should handle missing file", async () => {
    const result = await parseOpenCodeFile({
      filePath: join(tempDir, "nonexistent.json"),
      lastTotals: null,
    });
    expect(result.delta).toBeNull();
  });

  it("should handle corrupted JSON", async () => {
    const filePath = join(tempDir, "bad.json");
    await writeFile(filePath, "corrupted{{{");

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).toBeNull();
  });

  it("should handle empty tokens", async () => {
    const filePath = join(tempDir, "msg_empty.json");
    await writeFile(
      filePath,
      opencodeMsg({
        tokens: {
          total: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).toBeNull(); // all zero → skip
  });

  it("should return null delta when time fields are missing", async () => {
    const filePath = join(tempDir, "msg_no_time.json");
    await writeFile(
      filePath,
      opencodeMsg({
        time: {}, // no completed or created
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).toBeNull();
    expect(result.messageKey).toBe("ses_001|msg_001");
  });

  it("should return null delta when time object is missing entirely", async () => {
    const filePath = join(tempDir, "msg_no_time2.json");
    await writeFile(
      filePath,
      JSON.stringify({
        id: "msg_001",
        sessionID: "ses_001",
        role: "assistant",
        modelID: "claude-opus-4.6",
        tokens: {
          input: 100,
          output: 50,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        // no time field at all
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).toBeNull();
  });

  it("should fallback to model when modelID is missing", async () => {
    const filePath = join(tempDir, "msg_model_fallback.json");
    await writeFile(
      filePath,
      JSON.stringify({
        id: "msg_001",
        sessionID: "ses_001",
        role: "assistant",
        // no modelID
        model: "gpt-4o",
        time: { completed: 1771120822000 },
        tokens: {
          input: 100,
          output: 50,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).not.toBeNull();
    expect(result.delta!.model).toBe("gpt-4o");
  });

  it("should use 'unknown' when both modelID and model are missing", async () => {
    const filePath = join(tempDir, "msg_no_model.json");
    await writeFile(
      filePath,
      JSON.stringify({
        id: "msg_001",
        sessionID: "ses_001",
        role: "assistant",
        // no modelID, no model
        time: { completed: 1771120822000 },
        tokens: {
          input: 100,
          output: 50,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).not.toBeNull();
    expect(result.delta!.model).toBe("unknown");
  });

  it("should handle empty file content", async () => {
    const filePath = join(tempDir, "empty.json");
    await writeFile(filePath, "   ");

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).toBeNull();
  });

  it("should return null messageKey when sessionID or id is missing", async () => {
    const filePath = join(tempDir, "msg_no_session.json");
    await writeFile(
      filePath,
      opencodeMsg({
        id: undefined,
        sessionID: undefined,
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.messageKey).toBeNull();
  });

  it("should return null delta when tokens field is missing", async () => {
    const filePath = join(tempDir, "msg_no_tokens.json");
    await writeFile(
      filePath,
      JSON.stringify({
        id: "msg_001",
        sessionID: "ses_001",
        role: "assistant",
        modelID: "claude-opus-4.6",
        time: { completed: 1771120822000 },
        // no tokens field
      }),
    );

    const result = await parseOpenCodeFile({ filePath, lastTotals: null });
    expect(result.delta).toBeNull();
  });
});

describe("coerceEpochMs", () => {
  it("should return ms for epoch in milliseconds", () => {
    expect(coerceEpochMs(1771120822000)).toBe(1771120822000);
  });

  it("should convert epoch seconds to ms", () => {
    expect(coerceEpochMs(1771120822)).toBe(1771120822000);
  });

  it("should return 0 for non-finite values", () => {
    expect(coerceEpochMs(NaN)).toBe(0);
    expect(coerceEpochMs(Infinity)).toBe(0);
    expect(coerceEpochMs(-Infinity)).toBe(0);
  });

  it("should return 0 for negative or zero values", () => {
    expect(coerceEpochMs(0)).toBe(0);
    expect(coerceEpochMs(-100)).toBe(0);
  });

  it("should return 0 for non-numeric values", () => {
    expect(coerceEpochMs("not a number")).toBe(0);
    expect(coerceEpochMs(null)).toBe(0);
    expect(coerceEpochMs(undefined)).toBe(0);
  });
});

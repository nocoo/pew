/**
 * Type-level tests for @pew/core.
 *
 * These tests validate that the type definitions compile correctly
 * and that the Source enum contains exactly the 5 supported tools.
 */
import { describe, expect, it } from "vitest";
import type {
  ByteOffsetCursor,
  CursorState,
  GeminiCursor,
  HourBucket,
  OpenCodeCursor,
  QueueRecord,
  Source,
  TokenDelta,
  UsageRecord,
  PewConfig,
} from "../types.js";

describe("Source type", () => {
  it("should accept all 4 supported AI tools", () => {
    const sources: Source[] = [
      "claude-code",
      "gemini-cli",
      "opencode",
      "openclaw",
    ];
    expect(sources).toHaveLength(4);
  });

  it("should reject unsupported tools at type level", () => {
    // @ts-expect-error — "every-code" is not a valid Source
    const _invalid: Source = "every-code";
    expect(_invalid).toBeDefined();
  });
});

describe("TokenDelta type", () => {
  it("should hold token counts", () => {
    const delta: TokenDelta = {
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 500,
      reasoningOutputTokens: 0,
    };
    expect(delta.inputTokens).toBe(1000);
    expect(delta.cachedInputTokens).toBe(200);
    expect(delta.outputTokens).toBe(500);
    expect(delta.reasoningOutputTokens).toBe(0);
  });

  it("should compute totalTokens from components", () => {
    const delta: TokenDelta = {
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 500,
      reasoningOutputTokens: 100,
    };
    const total =
      delta.inputTokens + delta.outputTokens + delta.reasoningOutputTokens;
    expect(total).toBe(1600);
  });
});

describe("UsageRecord type", () => {
  it("should hold a complete usage record", () => {
    const record: UsageRecord = {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hourStart: "2026-03-07T10:00:00Z",
      tokens: {
        inputTokens: 5000,
        cachedInputTokens: 1000,
        outputTokens: 2000,
        reasoningOutputTokens: 0,
      },
    };
    expect(record.source).toBe("claude-code");
    expect(record.model).toBe("claude-sonnet-4-20250514");
    expect(record.hourStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:(00|30):00/);
    expect(record.tokens.inputTokens).toBe(5000);
  });
});

describe("HourBucket type", () => {
  it("should aggregate records into a bucket", () => {
    const bucket: HourBucket = {
      hourStart: "2026-03-07T10:00:00Z",
      records: [
        {
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          hourStart: "2026-03-07T10:00:00Z",
          tokens: {
            inputTokens: 5000,
            cachedInputTokens: 0,
            outputTokens: 2000,
            reasoningOutputTokens: 0,
          },
        },
        {
          source: "opencode",
          model: "o3",
          hourStart: "2026-03-07T10:00:00Z",
          tokens: {
            inputTokens: 3000,
            cachedInputTokens: 500,
            outputTokens: 1000,
            reasoningOutputTokens: 200,
          },
        },
      ],
    };
    expect(bucket.records).toHaveLength(2);
    expect(bucket.hourStart).toBe("2026-03-07T10:00:00Z");
  });
});

describe("SyncCursor types", () => {
  it("should hold byte-offset cursor for JSONL files", () => {
    const cursor: ByteOffsetCursor = {
      inode: 123456,
      offset: 4096,
      updatedAt: "2026-03-07T10:00:00Z",
    };
    expect(cursor.offset).toBe(4096);
    expect(cursor.inode).toBe(123456);
  });

  it("should hold Gemini cursor with array index", () => {
    const cursor: GeminiCursor = {
      inode: 789,
      lastIndex: 42,
      lastTotals: {
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 500,
        reasoningOutputTokens: 0,
      },
      lastModel: "gemini-3-flash",
      updatedAt: "2026-03-07T10:00:00Z",
    };
    expect(cursor.lastIndex).toBe(42);
    expect(cursor.lastTotals?.inputTokens).toBe(1000);
  });

  it("should hold OpenCode cursor with size/mtime detection", () => {
    const cursor: OpenCodeCursor = {
      inode: 555,
      size: 2048,
      mtimeMs: 1709827200000,
      lastTotals: null,
      messageKey: "ses_123|msg_456",
      updatedAt: "2026-03-07T10:00:00Z",
    };
    expect(cursor.size).toBe(2048);
    expect(cursor.messageKey).toBe("ses_123|msg_456");
  });

  it("should compose into CursorState", () => {
    const state: CursorState = {
      version: 1,
      files: {
        "/path/to/file.jsonl": {
          inode: 1,
          offset: 0,
          updatedAt: "2026-03-07T10:00:00Z",
        } satisfies ByteOffsetCursor,
      },
      updatedAt: null,
    };
    expect(state.version).toBe(1);
    expect(Object.keys(state.files)).toHaveLength(1);
  });
});

describe("QueueRecord type", () => {
  it("should hold a queue record matching vibeusage format", () => {
    const record: QueueRecord = {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-03-07T10:30:00.000Z",
      input_tokens: 5000,
      cached_input_tokens: 1000,
      output_tokens: 2000,
      reasoning_output_tokens: 0,
      total_tokens: 8000,
    };
    expect(record.source).toBe("claude-code");
    expect(record.total_tokens).toBe(8000);
  });
});

describe("PewConfig type", () => {
  it("should hold CLI configuration", () => {
    const config: PewConfig = {
      token: "pk_abc123",
    };
    expect(config.token).toBe("pk_abc123");
  });

  it("should allow empty config", () => {
    const config: PewConfig = {};
    expect(config.token).toBeUndefined();
  });
});

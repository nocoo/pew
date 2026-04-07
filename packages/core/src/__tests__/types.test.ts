/**
 * Type-level tests for @pew/core.
 *
 * These tests validate that the type definitions compile correctly
 * and that the Source enum contains exactly the 7 supported tools.
 */
import { describe, expect, it } from "vitest";
import type {
  ByteOffsetCursor,
  CodexCursor,
  CoordinatorRunResult,
  CursorState,
  GeminiCursor,
  HourBucket,
  NotifierOperationResult,
  NotifierStatus,
  OpenCodeCursor,
  QueueRecord,
  PewConfig,
  RunLogEntry,
  SessionCursorState,
  SessionFileCursor,
  SessionKind,
  SessionQueueRecord,
  SessionSnapshot,
  Source,
  SyncTrigger,
  TokenDelta,
  UsageRecord,
} from "../types.js";

describe("Source type", () => {
  it("should accept all 7 supported AI tools", () => {
    const sources: Source[] = [
      "claude-code",
      "codex",
      "gemini-cli",
      "opencode",
      "openclaw",
      "pi",
      "vscode-copilot",
      "copilot-cli",
    ];
    expect(sources).toHaveLength(8);
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
      mtimeMs: 1709827200000,
      size: 4096,
      offset: 4096,
      updatedAt: "2026-03-07T10:00:00Z",
    };
    expect(cursor.offset).toBe(4096);
    expect(cursor.inode).toBe(123456);
  });

  it("should hold Gemini cursor with array index", () => {
    const cursor: GeminiCursor = {
      inode: 789,
      mtimeMs: 1709827200000,
      size: 8192,
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

  it("should hold Codex cursor with offset + cumulative diff state", () => {
    const cursor: CodexCursor = {
      inode: 777,
      mtimeMs: 1709827200000,
      size: 16384,
      offset: 8192,
      lastTotals: {
        inputTokens: 5000,
        cachedInputTokens: 1000,
        outputTokens: 800,
        reasoningOutputTokens: 200,
      },
      lastModel: "gpt-5.4",
      updatedAt: "2026-03-07T10:00:00Z",
    };
    expect(cursor.offset).toBe(8192);
    expect(cursor.lastTotals?.inputTokens).toBe(5000);
    expect(cursor.lastModel).toBe("gpt-5.4");
  });

  it("should compose into CursorState", () => {
    const state: CursorState = {
      version: 1,
      files: {
        "/path/to/file.jsonl": {
          inode: 1,
          mtimeMs: 1709827200000,
          size: 1024,
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

describe("Notifier types", () => {
  it("should represent notify triggers with source and file hint", () => {
    const trigger: SyncTrigger = {
      kind: "notify",
      source: "codex",
      fileHint: "/tmp/rollout.jsonl",
    };
    expect(trigger.kind).toBe("notify");
    expect(trigger.source).toBe("codex");
    expect(trigger.fileHint).toBe("/tmp/rollout.jsonl");
  });

  it("should represent coordinator run results", () => {
    const result: CoordinatorRunResult = {
      runId: "2026-03-09T10:00:00.000Z-abc123",
      triggers: [{ kind: "startup" }],
      hadFollowUp: false,
      followUpCount: 0,
      waitedForLock: true,
      skippedSync: false,
      degradedToUnlocked: false,
      cycles: [],
    };
    expect(result.waitedForLock).toBe(true);
    expect(result.triggers).toHaveLength(1);
  });

  it("should represent run log entries with triggers array", () => {
    const entry: RunLogEntry = {
      runId: "2026-03-10T10:00:00.000Z-xyz789",
      version: "0.7.0",
      triggers: [
        { kind: "notify", source: "codex", fileHint: "/tmp/rollout.jsonl" },
        { kind: "notify", source: "gemini-cli" },
      ],
      startedAt: "2026-03-10T10:00:00.000Z",
      completedAt: "2026-03-10T10:00:01.000Z",
      durationMs: 1000,
      coordination: {
        waitedForLock: false,
        skippedSync: false,
        hadFollowUp: false,
        followUpCount: 0,
        degradedToUnlocked: false,
      },
      cycles: [],
      status: "success",
    };
    expect(entry.triggers).toHaveLength(2);
    expect(entry.triggers[0].kind).toBe("notify");
  });

  it("should constrain notifier status values", () => {
    const statuses: NotifierStatus[] = [
      "installed",
      "not-installed",
      "outdated",
      "error",
    ];
    expect(statuses).toHaveLength(4);
  });

  it("should describe notifier operation results", () => {
    const operation: NotifierOperationResult = {
      source: "gemini-cli",
      action: "install",
      changed: true,
      detail: "Hook installed",
      backupPath: "/tmp/settings.json.bak",
      warnings: ["matcher normalized"],
    };
    expect(operation.source).toBe("gemini-cli");
    expect(operation.warnings).toContain("matcher normalized");
  });
});

describe("SessionKind type", () => {
  it("should accept human and automated", () => {
    const kinds: SessionKind[] = ["human", "automated"];
    expect(kinds).toHaveLength(2);
  });
});

describe("SessionSnapshot type", () => {
  it("should hold a complete session snapshot", () => {
    const snapshot: SessionSnapshot = {
      sessionKey: "claude:ses-001",
      source: "claude-code",
      kind: "human",
      startedAt: "2026-03-07T10:00:00Z",
      lastMessageAt: "2026-03-07T11:30:00Z",
      durationSeconds: 5400,
      userMessages: 10,
      assistantMessages: 10,
      totalMessages: 20,
      projectRef: "abc123",
      model: "claude-sonnet-4-20250514",
      snapshotAt: "2026-03-09T06:00:00Z",
    };
    expect(snapshot.sessionKey).toBe("claude:ses-001");
    expect(snapshot.kind).toBe("human");
    expect(snapshot.durationSeconds).toBe(5400);
    expect(snapshot.totalMessages).toBe(20);
  });

  it("should allow null projectRef and model", () => {
    const snapshot: SessionSnapshot = {
      sessionKey: "opencode:ses_001",
      source: "opencode",
      kind: "human",
      startedAt: "2026-03-07T10:00:00Z",
      lastMessageAt: "2026-03-07T10:30:00Z",
      durationSeconds: 1800,
      userMessages: 5,
      assistantMessages: 5,
      totalMessages: 10,
      projectRef: null,
      model: null,
      snapshotAt: "2026-03-09T06:00:00Z",
    };
    expect(snapshot.projectRef).toBeNull();
    expect(snapshot.model).toBeNull();
  });
});

describe("SessionQueueRecord type", () => {
  it("should hold a session queue record with snake_case fields", () => {
    const record: SessionQueueRecord = {
      session_key: "gemini:ses-002",
      source: "gemini-cli",
      kind: "human",
      started_at: "2026-03-07T10:00:00Z",
      last_message_at: "2026-03-07T11:00:00Z",
      duration_seconds: 3600,
      user_messages: 8,
      assistant_messages: 8,
      total_messages: 16,
      project_ref: "proj-hash",
      model: "gemini-2.5-pro",
      snapshot_at: "2026-03-09T06:00:00Z",
    };
    expect(record.session_key).toBe("gemini:ses-002");
    expect(record.duration_seconds).toBe(3600);
  });
});

describe("SessionFileCursor type", () => {
  it("should hold mtime and size for dual-check", () => {
    const cursor: SessionFileCursor = {
      mtimeMs: 1709827200000,
      size: 4096,
    };
    expect(cursor.mtimeMs).toBe(1709827200000);
    expect(cursor.size).toBe(4096);
  });

  it("should allow omitting size (directory-based cursors)", () => {
    const cursor: SessionFileCursor = {
      mtimeMs: 1709827200000,
    };
    expect(cursor.mtimeMs).toBe(1709827200000);
    expect(cursor.size).toBeUndefined();
  });
});

describe("SessionCursorState type", () => {
  it("should compose into a cursor state", () => {
    const state: SessionCursorState = {
      version: 1,
      files: {
        "/path/to/session.jsonl": {
          mtimeMs: 1709827200000,
          size: 4096,
        },
      },
      updatedAt: "2026-03-09T06:00:00Z",
    };
    expect(state.version).toBe(1);
    expect(Object.keys(state.files)).toHaveLength(1);
  });

  it("should allow empty state", () => {
    const state: SessionCursorState = {
      version: 1,
      files: {},
      updatedAt: null,
    };
    expect(state.updatedAt).toBeNull();
    expect(Object.keys(state.files)).toHaveLength(0);
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

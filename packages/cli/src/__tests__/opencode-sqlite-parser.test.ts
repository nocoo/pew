import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseOpenCodeSqlite,
  processOpenCodeMessages,
  type MessageRow,
  type QueryMessagesFn,
} from "../parsers/opencode-sqlite.js";

/** Helper: build a data JSON blob for an assistant message */
function assistantData(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
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

/** Helper: build a MessageRow */
function msgRow(
  id: string,
  sessionId: string,
  timeCreated: number,
  data: string,
  role?: string | null,
): MessageRow {
  // If role not explicitly provided, extract from data JSON
  const resolvedRole =
    role !== undefined
      ? role
      : (() => {
          try {
            return ((JSON.parse(data) as Record<string, unknown>).role as string) ?? null;
          } catch {
            return null;
          }
        })();
  return { id, session_id: sessionId, time_created: timeCreated, role: resolvedRole, data };
}

/**
 * Create a mock queryMessages function from an array of MessageRow.
 * Filters rows where time_created > lastTimeCreated, ordered by time_created.
 */
function mockQuery(rows: MessageRow[]): QueryMessagesFn {
  return (lastTimeCreated: number) =>
    rows
      .filter((r) => r.time_created > lastTimeCreated)
      .sort((a, b) => a.time_created - b.time_created);
}

describe("processOpenCodeMessages", () => {
  it("should parse assistant messages", () => {
    const rows: MessageRow[] = [
      msgRow("msg_001", "ses_001", 1771120749059, assistantData()),
      msgRow(
        "msg_002",
        "ses_001",
        1771120822000,
        assistantData({
          modelID: "gemini-2.5-pro",
          tokens: {
            total: 5000,
            input: 4000,
            output: 1000,
            reasoning: 0,
            cache: { read: 500, write: 100 },
          },
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].source).toBe("opencode");
    expect(result.deltas[0].model).toBe("claude-opus-4.6");
    expect(result.deltas[0].tokens.inputTokens).toBe(14967);
    expect(result.deltas[0].tokens.outputTokens).toBe(437);
    expect(result.deltas[1].model).toBe("gemini-2.5-pro");
    expect(result.deltas[1].tokens.inputTokens).toBe(4100); // 4000 + 100 cache.write
    expect(result.deltas[1].tokens.cachedInputTokens).toBe(500);
    expect(result.maxTimeCreated).toBe(1771120822000);
  });

  it("should skip non-assistant messages", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_user",
        "ses_001",
        1771120749059,
        JSON.stringify({
          role: "user",
          time: { created: 1771120749059 },
        }),
      ),
      msgRow("msg_asst", "ses_001", 1771120822000, assistantData()),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("opencode");
  });

  it("should return empty deltas for empty input", () => {
    const result = processOpenCodeMessages([]);

    expect(result.deltas).toHaveLength(0);
    expect(result.maxTimeCreated).toBe(0);
  });

  it("should handle corrupted data JSON gracefully", () => {
    const rows: MessageRow[] = [
      msgRow("msg_bad", "ses_001", 1771120749059, "{{corrupted}}"),
      msgRow("msg_good", "ses_001", 1771120822000, assistantData()),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(1);
    expect(result.maxTimeCreated).toBe(1771120822000);
  });

  it("should skip messages with zero tokens", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_zero",
        "ses_001",
        1771120749059,
        assistantData({
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(0);
  });

  it("should skip messages with missing tokens", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_notokens",
        "ses_001",
        1771120749059,
        JSON.stringify({
          role: "assistant",
          modelID: "test-model",
          time: { completed: 1771120749059 },
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(0);
  });

  it("should skip messages with missing time fields", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_notime",
        "ses_001",
        1771120749059,
        JSON.stringify({
          role: "assistant",
          modelID: "test-model",
          time: {},
          tokens: {
            total: 100,
            input: 80,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(0);
  });

  it("should populate messageKeys for dedup", () => {
    const rows: MessageRow[] = [
      msgRow("msg_001", "ses_001", 1771120749059, assistantData()),
      msgRow("msg_002", "ses_002", 1771120822000, assistantData()),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.messageKeys).toEqual(new Set(["ses_001|msg_001", "ses_002|msg_002"]));
  });

  it("should handle reasoning tokens", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_think",
        "ses_001",
        1771120749059,
        assistantData({
          tokens: {
            total: 1000,
            input: 500,
            output: 300,
            reasoning: 200,
            cache: { read: 0, write: 0 },
          },
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.reasoningOutputTokens).toBe(200);
  });

  it("should fallback model from modelID to model field", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_model",
        "ses_001",
        1771120749059,
        assistantData({
          modelID: undefined,
          model: "gpt-4o",
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("gpt-4o");
  });

  it("should use 'unknown' when both modelID and model are missing", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_nomodel",
        "ses_001",
        1771120749059,
        JSON.stringify({
          role: "assistant",
          time: { completed: 1771120822000 },
          tokens: {
            total: 100,
            input: 80,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].model).toBe("unknown");
  });

  it("should handle epoch seconds in time fields (coercion)", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_epoch",
        "ses_001",
        1771120749059,
        assistantData({
          time: { created: 1771120749, completed: 1771120822 },
        }),
      ),
    ];

    const result = processOpenCodeMessages(rows);

    expect(result.deltas).toHaveLength(1);
    const ts = new Date(result.deltas[0].timestamp).getTime();
    expect(ts).toBe(1771120822000);
  });

  it("should track max time_created even for non-assistant rows", () => {
    const rows: MessageRow[] = [
      msgRow(
        "msg_user",
        "ses_001",
        9999999999999,
        JSON.stringify({
          role: "user",
          time: { created: 9999999999999 },
        }),
      ),
      msgRow("msg_asst", "ses_001", 1771120822000, assistantData()),
    ];

    const result = processOpenCodeMessages(rows);

    // max should include non-assistant rows for cursor tracking
    expect(result.maxTimeCreated).toBe(9999999999999);
  });
});

describe("parseOpenCodeSqlite (integration)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-opencode-sqlite-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty deltas when database does not exist", async () => {
    const result = await parseOpenCodeSqlite({
      dbPath: join(tempDir, "nonexistent.db"),
      lastTimeCreated: 0,
    });

    expect(result.deltas).toHaveLength(0);
    expect(result.maxTimeCreated).toBe(0);
    expect(result.inode).toBe(0);
  });

  it("should return inode and use queryMessages", async () => {
    // Create a dummy file to get an inode
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const rows: MessageRow[] = [msgRow("msg_001", "ses_001", 1771120749059, assistantData())];

    const result = await parseOpenCodeSqlite({
      dbPath,
      lastTimeCreated: 0,
      queryMessages: mockQuery(rows),
    });

    expect(result.inode).toBeGreaterThan(0);
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].source).toBe("opencode");
  });

  it("should use incremental cursor via queryMessages", async () => {
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const rows: MessageRow[] = [
      msgRow("msg_old", "ses_001", 1000000, assistantData()),
      msgRow(
        "msg_new",
        "ses_001",
        2000000,
        assistantData({
          tokens: {
            total: 100,
            input: 80,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }),
      ),
    ];

    const result = await parseOpenCodeSqlite({
      dbPath,
      lastTimeCreated: 1000000,
      queryMessages: mockQuery(rows),
    });

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].tokens.inputTokens).toBe(80);
    expect(result.maxTimeCreated).toBe(2000000);
  });

  it("should return empty when queryMessages is not provided", async () => {
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const result = await parseOpenCodeSqlite({
      dbPath,
      lastTimeCreated: 0,
      // no queryMessages
    });

    expect(result.deltas).toHaveLength(0);
  });

  it("should handle queryMessages throwing", async () => {
    const dbPath = join(tempDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const result = await parseOpenCodeSqlite({
      dbPath,
      lastTimeCreated: 0,
      queryMessages: () => {
        throw new Error("DB corrupted");
      },
    });

    expect(result.deltas).toHaveLength(0);
    expect(result.inode).toBe(0);
  });
});

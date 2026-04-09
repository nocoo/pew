import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectClaudeSessions } from "../parsers/claude-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Claude JSONL line */
function line(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-03-07T10:15:30.000Z",
    sessionId: "ses-001",
    message: {
      model: "claude-sonnet-4-20250514",
      usage: { input_tokens: 5000, output_tokens: 800 },
    },
    ...overrides,
  });
}

function userLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-03-07T10:14:00.000Z",
    sessionId: "ses-001",
    message: { role: "user", content: "Hello" },
    ...overrides,
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "pew-claude-session-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectClaudeSessions", () => {
  it("should return empty array for non-existent file", async () => {
    const result = await collectClaudeSessions(join(tmpDir, "nope.jsonl"));
    expect(result).toEqual([]);
  });

  it("should return empty array for empty file", async () => {
    const f = join(tmpDir, "empty.jsonl");
    await writeFile(f, "");
    const result = await collectClaudeSessions(f);
    expect(result).toEqual([]);
  });

  it("should collect a single session from one file", async () => {
    const f = join(tmpDir, "test.jsonl");
    const lines = [
      userLine(),
      line(),
      userLine({ timestamp: "2026-03-07T10:20:00.000Z" }),
      line({ timestamp: "2026-03-07T10:25:00.000Z" }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);

    const s = result[0];
    expect(s.sessionKey).toBe("claude:ses-001");
    expect(s.source).toBe("claude-code");
    expect(s.kind).toBe("human");
    expect(s.userMessages).toBe(2);
    expect(s.assistantMessages).toBe(2);
    expect(s.totalMessages).toBe(4);
    expect(s.startedAt).toBe("2026-03-07T10:14:00.000Z");
    expect(s.lastMessageAt).toBe("2026-03-07T10:25:00.000Z");
    expect(s.durationSeconds).toBe(660); // 11 min
    expect(s.model).toBe("claude-sonnet-4-20250514");
    expect(s.snapshotAt).toBeDefined();
  });

  it("should group multiple sessions in one file", async () => {
    const f = join(tmpDir, "multi.jsonl");
    const lines = [
      userLine({ sessionId: "ses-A" }),
      line({ sessionId: "ses-A" }),
      userLine({
        sessionId: "ses-B",
        timestamp: "2026-03-07T11:00:00.000Z",
      }),
      line({
        sessionId: "ses-B",
        timestamp: "2026-03-07T11:05:00.000Z",
      }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(2);

    const keys = result.map((s) => s.sessionKey).sort();
    expect(keys).toEqual(["claude:ses-A", "claude:ses-B"]);
  });

  it("should skip lines without sessionId", async () => {
    const f = join(tmpDir, "no-session.jsonl");
    const lines = [
      // No sessionId on this line
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-07T10:15:30.000Z",
        message: {
          model: "claude-sonnet-4",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      // Valid line with sessionId
      userLine(),
      line(),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    // The line without sessionId is skipped; only ses-001 session found
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toBe("claude:ses-001");
  });

  it("should handle malformed JSON lines gracefully", async () => {
    const f = join(tmpDir, "bad.jsonl");
    const lines = [
      "not json",
      "{broken",
      userLine(),
      line(),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(2);
  });

  it("should extract projectRef from file path", async () => {
    // Simulate ~/.claude/projects/{hash}/{file}.jsonl
    const projectDir = join(tmpDir, "projects", "abc123hash");
    await mkdir(projectDir, { recursive: true });
    const f = join(projectDir, "session.jsonl");
    await writeFile(f, [userLine(), line()].join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBe("d24f65a6f145d04d"); // SHA-256("abc123hash")[0:16]
  });

  it("should set projectRef to null when no projects/ in path", async () => {
    const f = join(tmpDir, "standalone.jsonl");
    await writeFile(f, [userLine(), line()].join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBeNull();
  });

  it("should use last seen model for the session", async () => {
    const f = join(tmpDir, "models.jsonl");
    const lines = [
      userLine(),
      line({ message: { model: "claude-sonnet-4", usage: { input_tokens: 1, output_tokens: 1 } } }),
      line({
        timestamp: "2026-03-07T10:30:00.000Z",
        message: { model: "claude-opus-4", usage: { input_tokens: 1, output_tokens: 1 } },
      }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("claude-opus-4");
  });

  it("should handle single-message session (duration = 0)", async () => {
    const f = join(tmpDir, "single.jsonl");
    await writeFile(f, line() + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].durationSeconds).toBe(0);
    expect(result[0].totalMessages).toBe(1);
    expect(result[0].userMessages).toBe(0);
    expect(result[0].assistantMessages).toBe(1);
  });

  it("should extract model from obj.model when message.model is missing", async () => {
    const f = join(tmpDir, "obj-model.jsonl");
    const lines = [
      userLine(),
      // Line with model on obj directly, not in message
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-07T10:16:00.000Z",
        sessionId: "ses-001",
        model: "claude-opus-4",
        message: { usage: { input_tokens: 100, output_tokens: 50 } },
      }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("claude-opus-4");
  });

  it("should count all message types in totalMessages", async () => {
    const f = join(tmpDir, "types.jsonl");
    const lines = [
      userLine(),
      line(),
      // system/tool type
      JSON.stringify({
        type: "system",
        timestamp: "2026-03-07T10:16:00.000Z",
        sessionId: "ses-001",
      }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectClaudeSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].userMessages).toBe(1);
    expect(result[0].assistantMessages).toBe(1);
    expect(result[0].totalMessages).toBe(3);
  });
});

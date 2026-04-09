import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectOpenClawSessions } from "../parsers/openclaw-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an OpenClaw message line (type: "message" with usage) */
function messageLine(overrides: Record<string, unknown> = {}): string {
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

/** Create a system line */
function systemLine(ts: string): string {
  return JSON.stringify({
    type: "system",
    timestamp: ts,
    content: "Session initialized",
  });
}

/** Create a tool line */
function toolLine(ts: string): string {
  return JSON.stringify({
    type: "tool",
    timestamp: ts,
    name: "bash",
    content: "ls -la",
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "pew-openclaw-session-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectOpenClawSessions", () => {
  it("should return empty array for non-existent file", async () => {
    const result = await collectOpenClawSessions(join(tmpDir, "nope.jsonl"));
    expect(result).toEqual([]);
  });

  it("should return empty array for empty file", async () => {
    const f = join(tmpDir, "empty.jsonl");
    await writeFile(f, "");
    const result = await collectOpenClawSessions(f);
    expect(result).toEqual([]);
  });

  it("should return empty array for malformed JSON lines only", async () => {
    const f = join(tmpDir, "bad.jsonl");
    await writeFile(f, "{broken\n{also broken\n");
    const result = await collectOpenClawSessions(f);
    expect(result).toEqual([]);
  });

  it("should collect a session from a typical JSONL file", async () => {
    // Simulate path: agents/my-agent/sessions/session.jsonl
    const f = join(tmpDir, "agents", "my-agent", "sessions", "session.jsonl");
    const dir = join(tmpDir, "agents", "my-agent", "sessions");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });

    const lines = [
      systemLine("2026-03-07T10:00:00.000Z"),
      messageLine({ timestamp: "2026-03-07T10:05:00.000Z" }),
      toolLine("2026-03-07T10:06:00.000Z"),
      messageLine({
        timestamp: "2026-03-07T10:10:00.000Z",
        message: {
          model: "claude-opus-4",
          usage: { input: 8000, output: 1200, totalTokens: 9200 },
        },
      }),
      messageLine({ timestamp: "2026-03-07T10:15:00.000Z" }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);

    const s = result[0];
    expect(s.source).toBe("openclaw");
    expect(s.kind).toBe("automated");
    expect(s.userMessages).toBe(0);
    expect(s.assistantMessages).toBe(3); // 3 message lines
    expect(s.totalMessages).toBe(5); // system + 3 message + tool
    expect(s.startedAt).toBe("2026-03-07T10:00:00.000Z");
    expect(s.lastMessageAt).toBe("2026-03-07T10:15:00.000Z");
    expect(s.durationSeconds).toBe(900); // 15 min
    expect(s.model).toBe("claude-sonnet-4"); // last seen
    expect(s.projectRef).toBe("178890c4e2da4e09"); // sha256("my-agent")[0:16]
    expect(s.snapshotAt).toBeDefined();
  });

  it("should derive sessionKey from sha256 of absolute path", async () => {
    const f = join(tmpDir, "session.jsonl");
    await writeFile(f, messageLine() + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toMatch(/^openclaw:[a-f0-9]+$/);
  });

  it("should extract projectRef (agent name) from path", async () => {
    const { mkdir } = await import("node:fs/promises");
    const dir = join(tmpDir, "agents", "code-reviewer", "sessions");
    await mkdir(dir, { recursive: true });
    const f = join(dir, "session-001.jsonl");
    await writeFile(f, messageLine() + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBe("e08ba693bb6ad36a"); // sha256("code-reviewer")[0:16]
  });

  it("should set projectRef to null when path has no agents pattern", async () => {
    const f = join(tmpDir, "random-session.jsonl");
    await writeFile(f, messageLine() + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBeNull();
  });

  it("should return empty when no entries have timestamps", async () => {
    const f = join(tmpDir, "no-ts.jsonl");
    const line = JSON.stringify({ type: "message", message: { model: "test" } });
    await writeFile(f, line + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toEqual([]);
  });

  it("should use last seen model from message entries", async () => {
    const f = join(tmpDir, "models.jsonl");
    const lines = [
      messageLine({
        timestamp: "2026-03-07T10:00:00.000Z",
        message: { model: "claude-sonnet-4", usage: { input: 100, output: 50, totalTokens: 150 } },
      }),
      messageLine({
        timestamp: "2026-03-07T10:05:00.000Z",
        message: { model: "claude-opus-4", usage: { input: 200, output: 100, totalTokens: 300 } },
      }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("claude-opus-4");
  });

  it("should handle empty lines in the middle of the file", async () => {
    const f = join(tmpDir, "empty-lines.jsonl");
    const lines = [
      systemLine("2026-03-07T10:00:00.000Z"),
      "", // empty line triggers `if (!line) continue`
      messageLine({ timestamp: "2026-03-07T10:05:00.000Z" }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(2);
  });

  it("should handle non-string type field", async () => {
    const f = join(tmpDir, "non-string-type.jsonl");
    const lines = [
      JSON.stringify({ type: 123, timestamp: "2026-03-07T10:00:00.000Z" }),
      messageLine({ timestamp: "2026-03-07T10:05:00.000Z" }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    // Both lines are valid JSON with timestamps, both counted in totalMessages
    expect(result[0].totalMessages).toBe(2);
    // Only the actual message type line counts as assistant
    expect(result[0].assistantMessages).toBe(1);
  });

  it("should handle non-string model in message", async () => {
    const f = join(tmpDir, "non-string-model.jsonl");
    const lines = [
      JSON.stringify({
        type: "message",
        timestamp: "2026-03-07T10:00:00.000Z",
        message: { model: 42 },
      }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBeNull();
  });

  it("should handle whitespace-only model in message", async () => {
    const f = join(tmpDir, "whitespace-model.jsonl");
    const lines = [
      JSON.stringify({
        type: "message",
        timestamp: "2026-03-07T10:00:00.000Z",
        message: { model: "   " },
      }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    // model.trim() === "" → falsy, so lastModel remains null
    expect(result[0].model).toBeNull();
  });

  it("should handle agents dir with empty agent name", async () => {
    const { mkdir } = await import("node:fs/promises");
    // Path: agents//sessions/session.jsonl (empty agent name)
    const dir = join(tmpDir, "agents", "", "sessions");
    await mkdir(dir, { recursive: true });
    const f = join(dir, "session.jsonl");
    await writeFile(f, messageLine() + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    // Empty agent name → parts[agentsIdx + 1] is "" → || null → projectRef is null
    expect(result[0].projectRef).toBeNull();
  });

  it("should handle mixed valid and invalid lines", async () => {
    const f = join(tmpDir, "mixed.jsonl");
    const lines = [
      "{broken json",
      systemLine("2026-03-07T10:00:00.000Z"),
      messageLine({ timestamp: "2026-03-07T10:05:00.000Z" }),
      "also broken{",
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectOpenClawSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(2); // system + message (broken lines skipped)
  });
});

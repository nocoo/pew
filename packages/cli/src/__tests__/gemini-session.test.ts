import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectGeminiSessions } from "../parsers/gemini-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function geminiSession(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: "ses-001",
    projectHash: "proj-abc",
    messages: [
      {
        id: "msg-1",
        type: "user",
        timestamp: "2026-03-07T10:00:00.000Z",
      },
      {
        id: "msg-2",
        type: "gemini",
        timestamp: "2026-03-07T10:05:00.000Z",
        model: "gemini-2.5-pro",
        tokens: { input: 1000, output: 200, cached: 0, thoughts: 50, tool: 0 },
      },
      {
        id: "msg-3",
        type: "user",
        timestamp: "2026-03-07T10:10:00.000Z",
      },
      {
        id: "msg-4",
        type: "gemini",
        timestamp: "2026-03-07T10:15:00.000Z",
        model: "gemini-2.5-pro",
        tokens: { input: 2000, output: 400, cached: 500, thoughts: 100, tool: 10 },
      },
    ],
    ...overrides,
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "pew-gemini-session-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectGeminiSessions", () => {
  it("should return empty array for non-existent file", async () => {
    const result = await collectGeminiSessions(join(tmpDir, "nope.json"));
    expect(result).toEqual([]);
  });

  it("should return empty array for empty file", async () => {
    const f = join(tmpDir, "empty.json");
    await writeFile(f, "");
    const result = await collectGeminiSessions(f);
    expect(result).toEqual([]);
  });

  it("should return empty array for malformed JSON", async () => {
    const f = join(tmpDir, "bad.json");
    await writeFile(f, "{broken");
    const result = await collectGeminiSessions(f);
    expect(result).toEqual([]);
  });

  it("should collect a single session", async () => {
    const f = join(tmpDir, "session-001.json");
    await writeFile(f, geminiSession());

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);

    const s = result[0];
    expect(s.sessionKey).toBe("gemini:ses-001");
    expect(s.source).toBe("gemini-cli");
    expect(s.kind).toBe("human");
    expect(s.userMessages).toBe(2);
    expect(s.assistantMessages).toBe(2);
    expect(s.totalMessages).toBe(4);
    expect(s.startedAt).toBe("2026-03-07T10:00:00.000Z");
    expect(s.lastMessageAt).toBe("2026-03-07T10:15:00.000Z");
    expect(s.durationSeconds).toBe(900); // 15 min
    expect(s.model).toBe("gemini-2.5-pro");
    expect(s.projectRef).toBe("aeb3ff0f7e5763f9"); // sha256("proj-abc")[0:16]
    expect(s.snapshotAt).toBeDefined();
  });

  it("should use file path hash as sessionKey when no sessionId", async () => {
    const f = join(tmpDir, "session-no-id.json");
    await writeFile(
      f,
      JSON.stringify({
        messages: [
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
          {
            type: "gemini",
            timestamp: "2026-03-07T10:05:00.000Z",
            model: "gemini-2.5-pro",
          },
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);
    // Should start with "gemini:" and contain a hash
    expect(result[0].sessionKey).toMatch(/^gemini:/);
    expect(result[0].sessionKey).not.toBe("gemini:undefined");
  });

  it("should set projectRef to null when no projectHash", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        sessionId: "ses-002",
        messages: [
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBeNull();
  });

  it("should handle empty messages array", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({ sessionId: "ses-003", messages: [] }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toEqual([]);
  });

  it("should use last seen model", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        sessionId: "ses-004",
        messages: [
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
          {
            type: "gemini",
            timestamp: "2026-03-07T10:05:00.000Z",
            model: "gemini-2.5-flash",
          },
          { type: "user", timestamp: "2026-03-07T10:10:00.000Z" },
          {
            type: "gemini",
            timestamp: "2026-03-07T10:15:00.000Z",
            model: "gemini-2.5-pro",
          },
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("gemini-2.5-pro");
  });

  it("should return empty when messages is not an array", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        sessionId: "ses-no-arr",
        projectHash: "hash",
        messages: "not-an-array",
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toEqual([]);
  });

  it("should count gemini type as assistant messages", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        sessionId: "ses-005",
        messages: [
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T10:05:00.000Z" },
          { type: "tool", timestamp: "2026-03-07T10:06:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T10:10:00.000Z" },
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].userMessages).toBe(1);
    expect(result[0].assistantMessages).toBe(2);
    expect(result[0].totalMessages).toBe(4);
  });

  it("should skip null/non-object messages in the array", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        sessionId: "ses-null-msg",
        messages: [
          null,
          "not-an-object",
          42,
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T10:05:00.000Z", model: "gemini-2.5-pro" },
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);
    // Only the 2 valid messages should be counted
    expect(result[0].totalMessages).toBe(2);
    expect(result[0].userMessages).toBe(1);
    expect(result[0].assistantMessages).toBe(1);
  });

  it("should return empty when all messages lack timestamps", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        sessionId: "ses-no-ts",
        messages: [
          { type: "user" },
          { type: "gemini", timestamp: 12345 }, // non-string timestamp
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toEqual([]);
  });

  it("should handle messages without model field", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        sessionId: "ses-no-model",
        messages: [
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T10:05:00.000Z" },
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBeNull();
  });

  it("should fall back to file-based sessionKey when sessionId is missing", async () => {
    const f = join(tmpDir, "session.json");
    await writeFile(
      f,
      JSON.stringify({
        messages: [
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T10:05:00.000Z" },
        ],
      }),
    );

    const result = await collectGeminiSessions(f);
    expect(result).toHaveLength(1);
    // Should use hash-based key when sessionId is absent
    expect(result[0].sessionKey).toMatch(/^gemini:[a-f0-9]{16}$/);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCodexSessions } from "../parsers/codex-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a session_meta line */
function sessionMetaLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2026-03-07T10:00:00.000Z",
    type: "session_meta",
    payload: {
      id: "019cb243-2c35-7f03-a94a-46b99385c1d6",
      timestamp: "2026-03-07T10:00:00.000Z",
      cwd: "/Users/nocoo/workspace/personal/pew",
      model: "gpt-5.4",
      originator: "codex_exec",
      cli_version: "0.106.0",
      ...overrides,
    },
  });
}

/** Create a turn_context line */
function turnContextLine(model: string, ts: string): string {
  return JSON.stringify({
    timestamp: ts,
    type: "turn_context",
    payload: {
      model,
      cwd: "/Users/nocoo/workspace/personal/pew",
      approval_policy: "on-failure",
      sandbox_policy: "read-only",
    },
  });
}

/** Create a response_item line */
function responseItemLine(role: string, ts: string): string {
  return JSON.stringify({
    timestamp: ts,
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: "input_text", text: "Hello" }],
    },
  });
}

/** Create a token_count event_msg line */
function tokenCountLine(
  ts: string,
  totals: Record<string, number>,
): string {
  return JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: totals.input ?? 0,
          cached_input_tokens: totals.cached ?? 0,
          output_tokens: totals.output ?? 0,
          reasoning_output_tokens: totals.reasoning ?? 0,
          total_tokens: totals.total ?? 0,
        },
      },
    },
  });
}

/** Create a generic event_msg line */
function eventMsgLine(payloadType: string, ts: string): string {
  return JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: payloadType,
      content: "some content",
    },
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "pew-codex-session-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectCodexSessions", () => {
  it("should return empty array for non-existent file", async () => {
    const result = await collectCodexSessions(join(tmpDir, "nope.jsonl"));
    expect(result).toEqual([]);
  });

  it("should return empty array for empty file", async () => {
    const f = join(tmpDir, "empty.jsonl");
    await writeFile(f, "");
    const result = await collectCodexSessions(f);
    expect(result).toEqual([]);
  });

  it("should return empty array for malformed JSON lines only", async () => {
    const f = join(tmpDir, "bad.jsonl");
    await writeFile(f, "{broken\n{also broken\n");
    const result = await collectCodexSessions(f);
    expect(result).toEqual([]);
  });

  it("should collect a session from a typical rollout file", async () => {
    const f = join(tmpDir, "rollout-abc.jsonl");
    const lines = [
      sessionMetaLine(),
      responseItemLine("developer", "2026-03-07T10:00:01.000Z"),
      responseItemLine("user", "2026-03-07T10:00:02.000Z"),
      turnContextLine("gpt-5.4", "2026-03-07T10:00:03.000Z"),
      tokenCountLine("2026-03-07T10:01:00.000Z", {
        input: 5000,
        cached: 1000,
        output: 800,
        reasoning: 200,
      }),
      responseItemLine("assistant", "2026-03-07T10:01:30.000Z"),
      responseItemLine("user", "2026-03-07T10:02:00.000Z"),
      tokenCountLine("2026-03-07T10:03:00.000Z", {
        input: 10000,
        cached: 3000,
        output: 1600,
        reasoning: 400,
      }),
      responseItemLine("assistant", "2026-03-07T10:03:30.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);

    const s = result[0];
    expect(s.source).toBe("codex");
    expect(s.kind).toBe("human");
    expect(s.sessionKey).toBe(
      "codex:019cb243-2c35-7f03-a94a-46b99385c1d6",
    );
    expect(s.userMessages).toBe(2);
    expect(s.assistantMessages).toBe(2);
    expect(s.totalMessages).toBe(9); // all valid lines
    expect(s.startedAt).toBe("2026-03-07T10:00:00.000Z");
    expect(s.lastMessageAt).toBe("2026-03-07T10:03:30.000Z");
    expect(s.durationSeconds).toBe(210); // 3.5 min
    expect(s.model).toBe("gpt-5.4");
    expect(s.projectRef).toBe("/Users/nocoo/workspace/personal/pew");
    expect(s.snapshotAt).toBeDefined();
  });

  it("should use session_meta.payload.id as session key", async () => {
    const f = join(tmpDir, "rollout-id.jsonl");
    const lines = [
      sessionMetaLine({ id: "my-unique-session-uuid" }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toBe("codex:my-unique-session-uuid");
  });

  it("should fallback to sha256 of path when no session_meta ID", async () => {
    const f = join(tmpDir, "rollout-no-id.jsonl");
    const lines = [
      eventMsgLine("user_message", "2026-03-07T10:00:00.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toMatch(/^codex:[a-f0-9]{16}$/);
  });

  it("should extract projectRef from session_meta.payload.cwd", async () => {
    const f = join(tmpDir, "rollout-cwd.jsonl");
    const lines = [
      sessionMetaLine({ cwd: "/home/user/my-project" }),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBe("/home/user/my-project");
  });

  it("should set projectRef to null when no session_meta cwd", async () => {
    const f = join(tmpDir, "rollout-no-cwd.jsonl");
    // event_msg with no session_meta → no cwd
    const lines = [
      eventMsgLine("user_message", "2026-03-07T10:00:00.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBeNull();
  });

  it("should prefer turn_context model over session_meta model", async () => {
    const f = join(tmpDir, "rollout-model.jsonl");
    const lines = [
      sessionMetaLine({ model: "gpt-5" }),
      turnContextLine("gpt-5.4", "2026-03-07T10:01:00.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("gpt-5.4");
  });

  it("should use session_meta model as fallback", async () => {
    const f = join(tmpDir, "rollout-fallback.jsonl");
    const lines = [
      sessionMetaLine({ model: "gpt-5" }),
      // no turn_context line
      responseItemLine("user", "2026-03-07T10:01:00.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("gpt-5");
  });

  it("should track model changes from multiple turn_context events", async () => {
    const f = join(tmpDir, "rollout-model-change.jsonl");
    const lines = [
      sessionMetaLine({ model: "gpt-5" }),
      turnContextLine("gpt-5.4", "2026-03-07T10:01:00.000Z"),
      turnContextLine("o3", "2026-03-07T10:05:00.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("o3"); // last seen
  });

  it("should return empty when no entries have timestamps", async () => {
    const f = join(tmpDir, "no-ts.jsonl");
    const line = JSON.stringify({
      type: "response_item",
      payload: { role: "user" },
    });
    await writeFile(f, line + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toEqual([]);
  });

  it("should handle mixed valid and invalid lines", async () => {
    const f = join(tmpDir, "mixed.jsonl");
    const lines = [
      "{broken json",
      sessionMetaLine(),
      responseItemLine("user", "2026-03-07T10:01:00.000Z"),
      "also broken{",
      responseItemLine("assistant", "2026-03-07T10:02:00.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    // only 3 valid JSON lines counted (broken lines skipped)
    expect(result[0].totalMessages).toBe(3);
    expect(result[0].userMessages).toBe(1);
    expect(result[0].assistantMessages).toBe(1);
  });

  it("should count all valid lines in totalMessages", async () => {
    const f = join(tmpDir, "rollout-all.jsonl");
    const lines = [
      sessionMetaLine(),
      turnContextLine("gpt-5.4", "2026-03-07T10:00:01.000Z"),
      responseItemLine("developer", "2026-03-07T10:00:02.000Z"),
      responseItemLine("user", "2026-03-07T10:00:03.000Z"),
      responseItemLine("assistant", "2026-03-07T10:00:04.000Z"),
      tokenCountLine("2026-03-07T10:00:05.000Z", { input: 100 }),
      eventMsgLine("user_message", "2026-03-07T10:00:06.000Z"),
      eventMsgLine("agent_message", "2026-03-07T10:00:07.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(8);
    // Only response_item with role user/assistant counted
    expect(result[0].userMessages).toBe(1);
    expect(result[0].assistantMessages).toBe(1);
  });

  it("should compute correct duration", async () => {
    const f = join(tmpDir, "rollout-dur.jsonl");
    const lines = [
      sessionMetaLine({
        id: "dur-test",
        timestamp: "2026-03-07T10:00:00.000Z",
      }),
      responseItemLine("user", "2026-03-07T10:30:00.000Z"),
      responseItemLine("assistant", "2026-03-07T11:00:00.000Z"),
    ];
    // Override top-level timestamp of session_meta
    const metaLine = JSON.stringify({
      timestamp: "2026-03-07T10:00:00.000Z",
      type: "session_meta",
      payload: { id: "dur-test", cwd: "/tmp", model: "gpt-5" },
    });
    await writeFile(
      f,
      [
        metaLine,
        responseItemLine("user", "2026-03-07T10:30:00.000Z"),
        responseItemLine("assistant", "2026-03-07T11:00:00.000Z"),
      ].join("\n") + "\n",
    );

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].durationSeconds).toBe(3600); // 1 hour
  });

  it("should set model to null when no model info present", async () => {
    const f = join(tmpDir, "rollout-no-model.jsonl");
    // Event with timestamp but no model info
    const lines = [
      eventMsgLine("user_message", "2026-03-07T10:00:00.000Z"),
    ];
    await writeFile(f, lines.join("\n") + "\n");

    const result = await collectCodexSessions(f);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBeNull();
  });
});

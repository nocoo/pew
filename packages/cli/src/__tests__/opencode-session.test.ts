import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectOpenCodeSessions } from "../parsers/opencode-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function opencodeMsg(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "msg_001",
    sessionID: "ses_001",
    role: "assistant",
    modelID: "claude-opus-4.6",
    time: {
      created: 1771120749.059,
      completed: 1771120822.0,
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

function userMsg(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "msg_user_001",
    sessionID: "ses_001",
    role: "user",
    time: {
      created: 1771120700.0,
    },
    ...overrides,
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "pew-opencode-session-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectOpenCodeSessions", () => {
  it("should return empty array for non-existent directory", async () => {
    const result = await collectOpenCodeSessions(join(tmpDir, "nope"));
    expect(result).toEqual([]);
  });

  it("should return empty array for empty directory", async () => {
    const dir = join(tmpDir, "ses_empty");
    await mkdir(dir);
    const result = await collectOpenCodeSessions(dir);
    expect(result).toEqual([]);
  });

  it("should collect a session from multiple message files", async () => {
    const dir = join(tmpDir, "ses_001");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_user_001.json"),
      userMsg({ time: { created: 1771120700.0 } }),
    );
    await writeFile(
      join(dir, "msg_001.json"),
      opencodeMsg({ time: { created: 1771120749.0, completed: 1771120822.0 } }),
    );
    await writeFile(
      join(dir, "msg_user_002.json"),
      userMsg({
        id: "msg_user_002",
        time: { created: 1771120900.0 },
      }),
    );
    await writeFile(
      join(dir, "msg_002.json"),
      opencodeMsg({
        id: "msg_002",
        time: { created: 1771120950.0, completed: 1771121000.0 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);

    const s = result[0];
    expect(s.sessionKey).toBe("opencode:ses_001");
    expect(s.source).toBe("opencode");
    expect(s.kind).toBe("human");
    expect(s.userMessages).toBe(2);
    expect(s.assistantMessages).toBe(2);
    expect(s.totalMessages).toBe(4);
    expect(s.durationSeconds).toBe(300); // 1771121000 - 1771120700 = 300s
    expect(s.model).toBe("claude-opus-4.6");
    expect(s.projectRef).toBeNull();
    expect(s.snapshotAt).toBeDefined();
  });

  it("should use directory name as sessionKey fallback", async () => {
    const dir = join(tmpDir, "ses_xyz");
    await mkdir(dir);
    // Message with no sessionID
    await writeFile(
      join(dir, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        role: "assistant",
        modelID: "gpt-4o",
        time: { created: 1771120749.0 },
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toBe("opencode:ses_xyz");
  });

  it("should use last seen model", async () => {
    const dir = join(tmpDir, "ses_002");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_001.json"),
      opencodeMsg({
        modelID: "gemini-2.5-flash",
        time: { created: 1771120700.0, completed: 1771120750.0 },
      }),
    );
    await writeFile(
      join(dir, "msg_002.json"),
      opencodeMsg({
        id: "msg_002",
        modelID: "claude-opus-4.6",
        time: { created: 1771120800.0, completed: 1771120900.0 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    // Last model alphabetically or by timestamp — depends on sort order
    // msg_002 sorts after msg_001, so claude-opus-4.6 is last
    expect(result[0].model).toBe("claude-opus-4.6");
  });

  it("should handle files with epoch milliseconds", async () => {
    const dir = join(tmpDir, "ses_003");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_001.json"),
      opencodeMsg({
        time: { created: 1771120700000, completed: 1771120800000 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(s => s.startedAt).toBeDefined();
  });

  it("should skip malformed JSON files gracefully", async () => {
    const dir = join(tmpDir, "ses_004");
    await mkdir(dir);
    await writeFile(join(dir, "msg_001.json"), "{broken");
    await writeFile(
      join(dir, "msg_002.json"),
      opencodeMsg({
        id: "msg_002",
        time: { created: 1771120800.0, completed: 1771120900.0 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(1); // only the valid message
  });

  it("should count all roles in totalMessages", async () => {
    const dir = join(tmpDir, "ses_005");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_001.json"),
      userMsg({ time: { created: 1771120700.0 } }),
    );
    await writeFile(
      join(dir, "msg_002.json"),
      opencodeMsg({
        id: "msg_002",
        time: { created: 1771120800.0 },
      }),
    );
    await writeFile(
      join(dir, "msg_003.json"),
      JSON.stringify({
        id: "msg_003",
        sessionID: "ses_005",
        role: "tool",
        time: { created: 1771120850.0 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].userMessages).toBe(1);
    expect(result[0].assistantMessages).toBe(1);
    expect(result[0].totalMessages).toBe(3);
  });

  it("should ignore non-json files in directory", async () => {
    const dir = join(tmpDir, "ses_006");
    await mkdir(dir);
    await writeFile(join(dir, "msg_001.json"), opencodeMsg({
      time: { created: 1771120700.0 },
    }));
    await writeFile(join(dir, "README.md"), "ignore me");
    await writeFile(join(dir, ".DS_Store"), "ignore me too");

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(1);
  });

  it("should fallback to msg.model when modelID is missing", async () => {
    const dir = join(tmpDir, "ses_model_fallback");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        sessionID: "ses_fb",
        role: "assistant",
        model: "gpt-4o",
        time: { created: 1771120700.0, completed: 1771120800.0 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("gpt-4o");
  });

  it("should handle unreadable message files gracefully", async () => {
    const dir = join(tmpDir, "ses_unreadable");
    await mkdir(dir);
    // Create a directory with .json extension (will fail to read as file)
    await mkdir(join(dir, "msg_bad.json"));
    await writeFile(
      join(dir, "msg_good.json"),
      opencodeMsg({
        id: "msg_good",
        time: { created: 1771120700.0, completed: 1771120800.0 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(1);
  });

  it("should return empty when all messages lack timestamps", async () => {
    const dir = join(tmpDir, "ses_007");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        sessionID: "ses_007",
        role: "assistant",
        modelID: "claude-opus-4.6",
        // no time field
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toEqual([]);
  });

  it("should handle message with only completed timestamp (no created)", async () => {
    const dir = join(tmpDir, "ses_completed_only");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        sessionID: "ses_co",
        role: "assistant",
        modelID: "claude-opus-4.6",
        time: { completed: 1771120800000 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    // Should use completed as both start and end
    expect(result[0].durationSeconds).toBe(0);
  });

  it("should skip messages without sessionID and use dir name as key", async () => {
    const dir = join(tmpDir, "ses_no_sid");
    await mkdir(dir);
    await writeFile(
      join(dir, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        role: "assistant",
        modelID: "claude-opus-4.6",
        time: { created: 1771120700000, completed: 1771120800000 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toBe("opencode:ses_no_sid");
  });

  it("should handle invalid JSON gracefully", async () => {
    const dir = join(tmpDir, "ses_bad_json");
    await mkdir(dir);
    await writeFile(join(dir, "msg_bad.json"), "not valid json {{{");
    await writeFile(
      join(dir, "msg_good.json"),
      opencodeMsg({
        id: "msg_good",
        time: { created: 1771120700000, completed: 1771120800000 },
      }),
    );

    const result = await collectOpenCodeSessions(dir);
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(1);
  });
});

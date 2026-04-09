import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectPiSessions } from "../parsers/pi-session.js";

describe("collectPiSessions", () => {
  let testDir: string;
  let sessionDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pew-pi-sess-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sessionDir = join(testDir, "--test-project--");
    await mkdir(sessionDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("extracts session snapshot from a pi JSONL file", async () => {
    const filePath = join(sessionDir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "abc-123",
        timestamp: "2026-04-07T04:41:54.637Z",
        cwd: "/test/project",
      }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        parentId: null,
        timestamp: "2026-04-07T04:42:25.000Z",
        message: { role: "user", content: [{ type: "text", text: "Hello" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "msg2",
        parentId: "msg1",
        timestamp: "2026-04-07T04:42:45.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6-1m",
          content: [{ type: "text", text: "Hi!" }],
          usage: { input: 3, output: 100, cacheRead: 0, cacheWrite: 1000 },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "msg3",
        parentId: "msg2",
        timestamp: "2026-04-07T04:43:00.000Z",
        message: { role: "toolResult", toolCallId: "t1", content: [] },
      }),
      JSON.stringify({
        type: "message",
        id: "msg4",
        parentId: "msg3",
        timestamp: "2026-04-07T04:44:00.000Z",
        message: {
          role: "assistant",
          model: "gemini-3-pro",
          content: [],
          usage: { input: 5, output: 200 },
        },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);

    const snap = snapshots[0];
    expect(snap.sessionKey).toBe("pi:abc-123");
    expect(snap.source).toBe("pi");
    expect(snap.kind).toBe("human");
    expect(snap.startedAt).toBe("2026-04-07T04:41:54.637Z");
    expect(snap.lastMessageAt).toBe("2026-04-07T04:44:00.000Z");
    expect(snap.userMessages).toBe(1);
    expect(snap.assistantMessages).toBe(2);
    // user(1) + assistant(2) + toolResult(1) = 4
    expect(snap.totalMessages).toBe(4);
    expect(snap.model).toBe("gemini-3-pro"); // last model wins
    expect(snap.durationSeconds).toBeGreaterThan(0);
    // projectRef is a hash of the directory name
    expect(snap.projectRef).toBeTruthy();
    expect(typeof snap.projectRef).toBe("string");
  });

  it("returns empty for file without session header", async () => {
    const filePath = join(sessionDir, "no-header.jsonl");
    await writeFile(filePath, JSON.stringify({
      type: "message",
      id: "msg1",
      timestamp: "2026-04-07T04:42:25.000Z",
      message: { role: "user", content: [] },
    }) + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(0);
  });

  it("returns empty for missing file", async () => {
    const snapshots = await collectPiSessions(join(testDir, "nonexistent.jsonl"));
    expect(snapshots).toHaveLength(0);
  });

  it("returns empty for empty file", async () => {
    const filePath = join(sessionDir, "empty.jsonl");
    await writeFile(filePath, "");
    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(0);
  });

  it("computes correct duration in seconds", async () => {
    const filePath = join(sessionDir, "duration.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        id: "dur-test",
        timestamp: "2026-04-07T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:05:30.000Z",
        message: { role: "assistant", model: "test-model", content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    // 10:05:30 - 10:00:00 = 330 seconds
    expect(snapshots[0].durationSeconds).toBe(330);
  });

  it("handles malformed lines gracefully", async () => {
    const filePath = join(sessionDir, "malformed.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "mal-test", timestamp: "2026-04-07T10:00:00.000Z" }),
      "not valid json",
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:01:00.000Z",
        message: { role: "user", content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].userMessages).toBe(1);
  });

  it("handles message with no msg field (null message)", async () => {
    const filePath = join(sessionDir, "no-msg.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "no-msg-test", timestamp: "2026-04-07T10:00:00.000Z" }),
      JSON.stringify({ type: "message", id: "msg1", timestamp: "2026-04-07T10:01:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "msg2",
        timestamp: "2026-04-07T10:02:00.000Z",
        message: { role: "user", content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    // Message without msg object is skipped but still counted before check
    expect(snapshots[0].userMessages).toBe(1);
  });

  it("handles session header with non-string id", async () => {
    const filePath = join(sessionDir, "bad-id.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: 123, timestamp: "2026-04-07T10:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:01:00.000Z",
        message: { role: "user", content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    // No session ID → returns empty
    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(0);
  });

  it("handles entries without timestamps", async () => {
    const filePath = join(sessionDir, "no-timestamp.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "no-ts", timestamp: "2026-04-07T10:00:00.000Z" }),
      JSON.stringify({ type: "message", id: "msg1", message: { role: "user", content: [] } }),
      JSON.stringify({ type: "message", id: "msg2", timestamp: 12345, message: { role: "assistant", model: "test", content: [] } }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    // Only the session header has a timestamp
    expect(snapshots[0].startedAt).toBe("2026-04-07T10:00:00.000Z");
  });

  it("handles assistant message with non-string model", async () => {
    const filePath = join(sessionDir, "bad-model.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "bm-test", timestamp: "2026-04-07T10:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:01:00.000Z",
        message: { role: "assistant", model: 123, content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].model).toBeNull();
  });

  it("handles assistant message with empty model string", async () => {
    const filePath = join(sessionDir, "empty-model.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "em-test", timestamp: "2026-04-07T10:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:01:00.000Z",
        message: { role: "assistant", model: "  ", content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    // Empty/whitespace model should not override null
    // Actually "  ".trim() = "" which is falsy, so model stays null
    expect(snapshots[0].model).toBeNull();
  });

  it("handles entries with non-string type", async () => {
    const filePath = join(sessionDir, "bad-type.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "bt-test", timestamp: "2026-04-07T10:00:00.000Z" }),
      JSON.stringify({ type: 123, timestamp: "2026-04-07T10:01:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:02:00.000Z",
        message: { role: "user", content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].userMessages).toBe(1);
  });

  it("handles empty lines in file", async () => {
    const filePath = join(sessionDir, "empty-lines.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "el-test", timestamp: "2026-04-07T10:00:00.000Z" }),
      "",
      "",
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:01:00.000Z",
        message: { role: "user", content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].userMessages).toBe(1);
  });

  it("handles message with non-string role", async () => {
    const filePath = join(sessionDir, "bad-role.jsonl");
    const lines = [
      JSON.stringify({ type: "session", id: "br-test", timestamp: "2026-04-07T10:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "msg1",
        timestamp: "2026-04-07T10:01:00.000Z",
        message: { role: 999, content: [] },
      }),
    ];
    await writeFile(filePath, lines.join("\n") + "\n");

    const snapshots = await collectPiSessions(filePath);
    expect(snapshots).toHaveLength(1);
    // Non-string role = null, counts toward total but not user/assistant
    expect(snapshots[0].totalMessages).toBe(1);
    expect(snapshots[0].userMessages).toBe(0);
    expect(snapshots[0].assistantMessages).toBe(0);
  });
});

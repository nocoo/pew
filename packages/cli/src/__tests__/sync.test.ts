import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSync, type SyncResult } from "../commands/sync.js";
import type { QueueRecord } from "@zebra/core";

/** Helper: create Claude JSONL content */
function claudeLine(ts: string, input: number, output: number): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      model: "glm-5",
      stop_reason: "end_turn",
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: output,
      },
    },
  });
}

/** Helper: create Gemini session JSON */
function geminiSession(ts: string, input: number, output: number): string {
  return JSON.stringify({
    sessionId: "ses-001",
    messages: [
      {
        id: "msg-1",
        type: "gemini",
        timestamp: ts,
        model: "gemini-3-flash",
        tokens: { input, output, cached: 0, thoughts: 0, tool: 0, total: input + output },
      },
    ],
  });
}

/** Helper: create OpenCode message JSON */
function opencodeMsg(ts: number, input: number, output: number): string {
  return JSON.stringify({
    id: "msg_001",
    sessionID: "ses_001",
    role: "assistant",
    modelID: "claude-opus-4.6",
    time: { created: ts, completed: ts + 1000 },
    tokens: {
      total: input + output,
      input,
      output,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  });
}

/** Helper: create OpenClaw JSONL line */
function openclawLine(ts: string, input: number, output: number): string {
  return JSON.stringify({
    type: "message",
    timestamp: ts,
    message: {
      model: "claude-sonnet-4",
      usage: {
        input,
        cacheRead: 0,
        cacheWrite: 0,
        output,
        totalTokens: input + output,
      },
    },
  });
}

describe("executeSync", () => {
  let tempDir: string;
  let dataDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-sync-test-"));
    dataDir = join(tempDir, "data");
    stateDir = join(tempDir, "state");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should sync Claude data files to queue", async () => {
    // Set up Claude data
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    expect(result.totalDeltas).toBe(1);
    expect(result.totalRecords).toBe(1);
    expect(result.sources.claude).toBe(1);

    // Verify queue file was created
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("claude-code");
    expect(records[0].model).toBe("glm-5");
    expect(records[0].input_tokens).toBe(5000);
    expect(records[0].output_tokens).toBe(800);
    expect(records[0].hour_start).toBe("2026-03-07T10:00:00.000Z");
  });

  it("should sync Gemini data files to queue", async () => {
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-b", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-2026-03-07.json"),
      geminiSession("2026-03-07T10:15:00.000Z", 3000, 200),
    );

    const result = await executeSync({
      stateDir,
      geminiDir: join(dataDir, ".gemini"),
    });

    expect(result.totalDeltas).toBe(1);
    expect(result.sources.gemini).toBe(1);
  });

  it("should sync OpenCode data files to queue", async () => {
    const ocDir = join(dataDir, "opencode", "message", "ses_001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg(1771120749059, 14967, 437),
    );

    const result = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });

    expect(result.totalDeltas).toBe(1);
    expect(result.sources.opencode).toBe(1);
  });

  it("should sync OpenClaw data files to queue", async () => {
    const agentDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "session.jsonl"),
      openclawLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const result = await executeSync({
      stateDir,
      openclawDir: join(dataDir, ".openclaw"),
    });

    expect(result.totalDeltas).toBe(1);
    expect(result.sources.openclaw).toBe(1);
  });

  it("should be incremental (second sync produces no new records)", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const r1 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r1.totalDeltas).toBe(1);

    // Second sync: no new data
    const r2 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should aggregate multiple deltas into one bucket record", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    // Two events in the same half-hour bucket, same model
    const content = [
      claudeLine("2026-03-07T10:05:00.000Z", 1000, 100),
      claudeLine("2026-03-07T10:20:00.000Z", 2000, 200),
    ].join("\n") + "\n";
    await writeFile(join(claudeDir, "session.jsonl"), content);

    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    expect(result.totalDeltas).toBe(2);
    expect(result.totalRecords).toBe(1); // aggregated into one bucket

    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records).toHaveLength(1);
    expect(records[0].input_tokens).toBe(3000); // 1000 + 2000
    expect(records[0].output_tokens).toBe(300); // 100 + 200
  });

  it("should handle no data directories at all", async () => {
    const result = await executeSync({ stateDir });
    expect(result.totalDeltas).toBe(0);
    expect(result.totalRecords).toBe(0);
  });

  it("should sync multiple sources in one run", async () => {
    // Claude
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );
    // Gemini
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-b", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-2026-03-07.json"),
      geminiSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );

    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    expect(result.totalDeltas).toBe(2);
    expect(result.sources.claude).toBe(1);
    expect(result.sources.gemini).toBe(1);
  });
});

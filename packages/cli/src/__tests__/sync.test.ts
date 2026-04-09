import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSync, type SyncResult } from "../commands/sync.js";
import type { QueueRecord } from "@pew/core";

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

/** Helper: create Codex CLI JSONL content (session_meta + turn_context + token_count) */
function codexLines(ts: string, input: number, output: number): string {
  const meta = JSON.stringify({
    timestamp: ts,
    type: "session_meta",
    payload: { id: "ses-codex-001", cwd: "/tmp/project", model: "gpt-5.4" },
  });
  const ctx = JSON.stringify({
    timestamp: ts,
    type: "turn_context",
    payload: { model: "gpt-5.4", cwd: "/tmp/project" },
  });
  const tok = JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output,
        },
      },
    },
  });
  return [meta, ctx, tok].join("\n");
}

describe("executeSync", () => {
  let tempDir: string;
  let dataDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-sync-test-"));
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
    expect(result.filesScanned.claude).toBe(1);

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
    expect(result.filesScanned.gemini).toBe(1);
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
    expect(result.filesScanned.opencode).toBe(1);
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
    expect(result.filesScanned.openclaw).toBe(1);
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

  // ===== Codex CLI sync =====

  it("should sync Codex data files to queue", async () => {
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "rollout-abc123.jsonl"),
      codexLines("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const result = await executeSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });

    expect(result.totalDeltas).toBe(1);
    expect(result.totalRecords).toBe(1);
    expect(result.sources.codex).toBe(1);
    expect(result.filesScanned.codex).toBe(1);

    // Verify queue file was created
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("codex");
    expect(records[0].model).toBe("gpt-5.4");
    expect(records[0].input_tokens).toBe(5000);
    expect(records[0].output_tokens).toBe(800);
  });

  it("should be incremental for Codex (second sync with no changes produces no new data)", async () => {
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "rollout-abc123.jsonl"),
      codexLines("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const r1 = await executeSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });
    expect(r1.totalDeltas).toBe(1);
    expect(r1.sources.codex).toBe(1);

    // Second sync: no new data
    const r2 = await executeSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should sync only new Codex lines appended after first sync", async () => {
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    const filePath = join(codexDir, "rollout-abc123.jsonl");
    await writeFile(
      filePath,
      codexLines("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const r1 = await executeSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });
    expect(r1.totalDeltas).toBe(1);

    // Append a new token_count line (cumulative totals increase)
    const existing = await readFile(filePath, "utf-8");
    const newTokenLine = JSON.stringify({
      timestamp: "2026-03-07T11:15:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 8000,
            cached_input_tokens: 0,
            output_tokens: 1200,
            reasoning_output_tokens: 0,
            total_tokens: 9200,
          },
        },
      },
    });
    await writeFile(filePath, existing + newTokenLine + "\n");

    const r2 = await executeSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });
    // Should get the diff: 8000-5000=3000 input, 1200-800=400 output
    expect(r2.totalDeltas).toBe(1);
    expect(r2.sources.codex).toBe(1);

    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    // Second record should be the diff
    const codexRecords = records.filter((r) => r.source === "codex");
    expect(codexRecords).toHaveLength(2);
    // The second record should have the diff tokens
    expect(codexRecords[1].input_tokens).toBe(3000);
    expect(codexRecords[1].output_tokens).toBe(400);
  });

  // ===== OpenCode incremental sync + triple-check skip =====

  it("should be incremental for OpenCode (second sync with no file changes skips parsing)", async () => {
    const ocDir = join(dataDir, "opencode", "message", "ses_001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg(1771120749059, 14967, 437),
    );

    const r1 = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });
    expect(r1.totalDeltas).toBe(1);
    expect(r1.sources.opencode).toBe(1);

    // Second sync: file unchanged → triple-check (inode+size+mtime) should skip
    const r2 = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);
    expect(r2.sources.opencode).toBe(0);
  });

  it("should detect new OpenCode file added to existing session directory", async () => {
    // OpenCode message files are immutable — new messages create new files.
    // Directory mtime changes when a new file is created, triggering re-scan.
    const ocDir = join(dataDir, "opencode", "message", "ses_001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(join(ocDir, "msg_001.json"), opencodeMsg(1771120749059, 100, 50));

    const r1 = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });
    expect(r1.totalDeltas).toBe(1);

    // Wait to ensure mtime differs, then add a NEW file (simulating a new message)
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(ocDir, "msg_002.json"), opencodeMsg(1771120799059, 200, 100));

    const r2 = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });
    // New file in directory → directory mtime changed → re-scan → find new file
    expect(r2.totalDeltas).toBe(1);
    expect(r2.sources.opencode).toBe(1);
  });

  // ===== OpenClaw incremental sync =====

  it("should be incremental for OpenClaw (second sync with no changes produces no new data)", async () => {
    const agentDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "session.jsonl"),
      openclawLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const r1 = await executeSync({
      stateDir,
      openclawDir: join(dataDir, ".openclaw"),
    });
    expect(r1.totalDeltas).toBe(1);
    expect(r1.sources.openclaw).toBe(1);

    // Second sync: no new data
    const r2 = await executeSync({
      stateDir,
      openclawDir: join(dataDir, ".openclaw"),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should sync only new OpenClaw lines appended after first sync", async () => {
    const agentDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(agentDir, { recursive: true });
    const filePath = join(agentDir, "session.jsonl");
    await writeFile(
      filePath,
      openclawLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const r1 = await executeSync({
      stateDir,
      openclawDir: join(dataDir, ".openclaw"),
    });
    expect(r1.totalDeltas).toBe(1);

    // Append new line
    const existing = await readFile(filePath, "utf-8");
    await writeFile(
      filePath,
      existing + openclawLine("2026-03-07T11:15:00.000Z", 3000, 400) + "\n",
    );

    const r2 = await executeSync({
      stateDir,
      openclawDir: join(dataDir, ".openclaw"),
    });
    expect(r2.totalDeltas).toBe(1);
    expect(r2.sources.openclaw).toBe(1);
  });

  // ===== Progress callback coverage =====

  it("should fire progress events for all phases", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    const events: Array<{ source: string; phase: string }> = [];

    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase }),
    });

    // Should have: discover, parse (announce), parse (per-file), aggregate, done
    expect(events.some((e) => e.source === "claude-code" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "claude-code" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "all" && e.phase === "aggregate")).toBe(true);
    expect(events.some((e) => e.source === "all" && e.phase === "done")).toBe(true);
  });

  it("should fire progress events for OpenCode sync including dir-level skip", async () => {
    const ocDir = join(dataDir, "opencode", "message", "ses_001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg(1771120749059, 14967, 437),
    );

    // First sync to populate cursors and dirMtimes
    await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });

    // Second sync: dir-level mtime skip means 0 files discovered in changed dirs
    const events: Array<{ source: string; phase: string; current?: number; total?: number; message?: string }> = [];
    await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, current: e.current, total: e.total, message: e.message }),
    });

    expect(events.some((e) => e.source === "opencode" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "opencode" && e.phase === "parse")).toBe(true);
    // With dir-level mtime optimization, total files should be 0 (entire dir skipped)
    const parseEvent = events.find((e) => e.source === "opencode" && e.phase === "parse" && e.total !== undefined);
    expect(parseEvent?.total).toBe(0);
    expect(parseEvent?.message).toContain("1 dirs skipped");
  });

  // ===== All five sources in one run =====

  it("should fire progress events for all five sources", async () => {
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
    // OpenCode
    const ocDir = join(dataDir, "opencode", "message", "ses_001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg(1771120749059, 14967, 437),
    );
    // OpenClaw
    const agentDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "session.jsonl"),
      openclawLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );
    // Codex
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "rollout-abc123.jsonl"),
      codexLines("2026-03-07T10:15:00.000Z", 3000, 500) + "\n",
    );

    const events: Array<{ source: string; phase: string }> = [];

    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
      openCodeMessageDir: join(dataDir, "opencode", "message"),
      openclawDir: join(dataDir, ".openclaw"),
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase }),
    });

    // Verify all five sources emit discover + parse events
    expect(events.some((e) => e.source === "claude-code" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "claude-code" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "gemini-cli" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "gemini-cli" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "opencode" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "opencode" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "openclaw" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "openclaw" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "codex" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "codex" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "all" && e.phase === "aggregate")).toBe(true);
    expect(events.some((e) => e.source === "all" && e.phase === "done")).toBe(true);
  });

  // ===== Error isolation tests =====

  it("should continue syncing other Claude files when one file's parser throws", async () => {
    // Set up two Claude project dirs with one file each
    const proj1 = join(dataDir, ".claude", "projects", "proj-good");
    const proj2 = join(dataDir, ".claude", "projects", "proj-bad");
    await mkdir(proj1, { recursive: true });
    await mkdir(proj2, { recursive: true });

    // Good file: valid JSONL
    await writeFile(
      join(proj1, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // Bad file: starts with valid-looking content but will cause readline to
    // emit a line that triggers an unhandled error deeper in the parser.
    // We write binary content that createReadStream will read but cannot
    // be processed by readline without error on certain Node versions.
    // Instead, we use vi.spyOn to make the parser throw for one specific file.
    await writeFile(
      join(proj2, "bad.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 2000, 200) + "\n",
    );

    // Spy on the parser module to throw for the bad file path
    const claudeParser = await import("../parsers/claude.js");
    const origParse = claudeParser.parseClaudeFile;
    const spy = vi.spyOn(claudeParser, "parseClaudeFile").mockImplementation(
      async (opts) => {
        if (opts.filePath.includes("proj-bad")) {
          throw new Error("Simulated parser explosion");
        }
        return origParse(opts);
      },
    );

    // Collect progress events to verify warning is emitted
    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
        onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // The good file's data should still be synced
      expect(result.totalDeltas).toBe(1);
      expect(result.sources.claude).toBe(1);

      // Verify queue was written (not lost)
      const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
      const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
      expect(records).toHaveLength(1);
      expect(records[0].input_tokens).toBe(1000);

      // Verify a warning was emitted for the bad file
      expect(events.some((e) => e.phase === "warn")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("should continue syncing other sources when one source's parser throws", async () => {
    // Claude: will have a file that throws
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // OpenClaw: healthy data
    const agentDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "session.jsonl"),
      openclawLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    // Make ALL Claude parses throw
    const claudeParser = await import("../parsers/claude.js");
    const spy = vi.spyOn(claudeParser, "parseClaudeFile").mockRejectedValue(
      new Error("Claude parser crash"),
    );

    try {
      const result = await executeSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
        openclawDir: join(dataDir, ".openclaw"),
      });

      // OpenClaw data should still be synced despite Claude failure
      expect(result.sources.openclaw).toBe(1);
      expect(result.totalRecords).toBeGreaterThanOrEqual(1);

      // Verify queue has the OpenClaw record
      const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
      const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
      expect(records.some((r) => r.source === "openclaw")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  // ===== Write-order resilience tests (HIGH-2) =====

  it("should save cursors AFTER queue (cursor-after-queue write order)", async () => {
    // This test verifies that cursors are persisted AFTER the queue,
    // so if the process crashes after queue overwrite but before cursor save,
    // the next sync will re-scan from the old cursor position (producing a
    // superset). This is the correct trade-off: slight over-count on crash
    // is better than N× inflation on cursor reset.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // Import the LocalQueue module to spy on overwrite
    const localQueueModule = await import("../storage/local-queue.js");

    // Let overwrite succeed but then throw BEFORE cursor save
    // We achieve this by spying on overwrite to record that it was called,
    // then spying on CursorStore.save to throw
    let overwriteCalled = false;
    const overwriteSpy = vi.spyOn(localQueueModule.LocalQueue.prototype, "overwrite")
      .mockImplementation(async function(this: InstanceType<typeof localQueueModule.LocalQueue>) {
        overwriteCalled = true;
        // Don't actually write — we just want to verify the call order
        throw new Error("Simulated crash after queue write");
      });

    try {
      await executeSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
      }).catch(() => {
        // Expected to throw due to queue write failure
      });
    } finally {
      overwriteSpy.mockRestore();
    }

    expect(overwriteCalled).toBe(true);

    // Cursors should NOT be saved (queue crash prevents cursor save)
    const { CursorStore } = await import("../storage/cursor-store.js");
    const cursorStore = new CursorStore(stateDir);
    const cursors = await cursorStore.load();
    expect(Object.keys(cursors.files)).toHaveLength(0);

    // Next sync should re-process everything from scratch
    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    expect(result.totalDeltas).toBe(1);
    expect(result.totalRecords).toBe(1);
  });

  it("should sync all five sources simultaneously", async () => {
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
    // OpenCode
    const ocDir = join(dataDir, "opencode", "message", "ses_001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg(1771120749059, 14967, 437),
    );
    // OpenClaw
    const agentDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "session.jsonl"),
      openclawLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );
    // Codex
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "rollout-abc123.jsonl"),
      codexLines("2026-03-07T10:15:00.000Z", 3000, 500) + "\n",
    );

    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
      openCodeMessageDir: join(dataDir, "opencode", "message"),
      openclawDir: join(dataDir, ".openclaw"),
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });

    expect(result.totalDeltas).toBe(5);
    expect(result.sources.claude).toBe(1);
    expect(result.sources.gemini).toBe(1);
    expect(result.sources.opencode).toBe(1);
    expect(result.sources.openclaw).toBe(1);
    expect(result.sources.codex).toBe(1);
    expect(result.filesScanned.claude).toBe(1);
    expect(result.filesScanned.gemini).toBe(1);
    expect(result.filesScanned.opencode).toBe(1);
    expect(result.filesScanned.openclaw).toBe(1);
    expect(result.filesScanned.codex).toBe(1);
  });

  // ===== OpenCode SQLite integration =====

  /**
   * Helper: create a mock openMessageDb factory that returns rows from an in-memory array.
   * Simulates the bun:sqlite adapter without requiring the actual runtime.
   */
  function mockOpenMessageDb(rows: Array<{ id: string; session_id: string; time_created: number; role?: string | null; data: string }>) {
    // Auto-populate role from data JSON if not explicitly provided
    const enrichedRows = rows.map((r) => ({
      ...r,
      role: r.role !== undefined ? r.role : (() => {
        try { return (JSON.parse(r.data) as Record<string, unknown>).role as string ?? null; } catch { return null; }
      })(),
    }));
    return (_dbPath: string) => ({
      queryMessages: (lastTimeCreated: number) =>
        enrichedRows.filter((r) => r.time_created >= lastTimeCreated),
      close: () => {},
    });
  }

  /** Helper: build a SQLite message row JSON data blob */
  function sqliteRowData(opts: {
    role: string;
    modelID?: string;
    input?: number;
    output?: number;
    timeCreated?: number;
    timeCompleted?: number;
  }): string {
    return JSON.stringify({
      role: opts.role,
      modelID: opts.modelID ?? "claude-sonnet-4-20250514",
      time: {
        created: opts.timeCreated ?? 1739600000000,
        completed: opts.timeCompleted ?? (opts.timeCreated ?? 1739600000000) + 5000,
      },
      tokens: opts.role === "assistant"
        ? { total: (opts.input ?? 100) + (opts.output ?? 50), input: opts.input ?? 100, output: opts.output ?? 50, reasoning: 0, cache: { read: 0, write: 0 } }
        : null,
    });
  }

  it("should sync OpenCode SQLite data to queue", async () => {
    const rows = [
      { id: "msg_001", session_id: "ses_001", time_created: 1739600000000, data: sqliteRowData({ role: "assistant", input: 5000, output: 800, timeCreated: 1739600000000 }) },
      { id: "msg_002", session_id: "ses_001", time_created: 1739600010000, data: sqliteRowData({ role: "user", timeCreated: 1739600010000 }) },
      { id: "msg_003", session_id: "ses_001", time_created: 1739600020000, data: sqliteRowData({ role: "assistant", input: 3000, output: 200, timeCreated: 1739600020000 }) },
    ];

    // Create a dummy DB file so stat() succeeds
    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const result = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
    });

    // 2 assistant messages with tokens → 2 deltas
    expect(result.totalDeltas).toBe(2);
    expect(result.sources.opencode).toBe(2);
    expect(result.totalRecords).toBeGreaterThanOrEqual(1);
  });

  it("should be incremental for OpenCode SQLite (second sync with no new rows)", async () => {
    const rows = [
      { id: "msg_001", session_id: "ses_001", time_created: 1739600000000, data: sqliteRowData({ role: "assistant", input: 5000, output: 800, timeCreated: 1739600000000 }) },
    ];

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const r1 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
    });
    expect(r1.totalDeltas).toBe(1);

    // Second sync: cursor has advanced, no new rows
    const r2 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should dedup SQLite rows against JSON messageKeys during overlap window", async () => {
    // Simulate overlap: same message exists in both JSON file and SQLite

    // Step 1: sync the JSON file first
    const ocDir = join(dataDir, "opencode", "message", "ses_001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg(1739600000000, 14967, 437),
    );

    const r1 = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });
    expect(r1.totalDeltas).toBe(1);
    expect(r1.sources.opencode).toBe(1);

    // Step 2: now sync with SQLite containing the SAME message + a new one
    const dbDir = join(dataDir, "opencode");
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const sqliteRows = [
      // Same message as JSON — should be deduped
      { id: "msg_001", session_id: "ses_001", time_created: 1739600000000, data: sqliteRowData({ role: "assistant", input: 14967, output: 437, timeCreated: 1739600000000 }) },
      // New message — should be included
      { id: "msg_002", session_id: "ses_001", time_created: 1739600020000, data: sqliteRowData({ role: "assistant", input: 3000, output: 200, timeCreated: 1739600020000 }) },
    ];

    const r2 = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(sqliteRows),
    });

    // JSON file unchanged (triple-check skip) → 0 from JSON
    // SQLite: msg_001 deduped, msg_002 is new → 1 from SQLite
    expect(r2.sources.opencode).toBe(1);
    expect(r2.totalDeltas).toBe(1);
  });

  it("should gracefully skip when SQLite DB file does not exist", async () => {
    const result = await executeSync({
      stateDir,
      openCodeDbPath: "/nonexistent/opencode.db",
      openMessageDb: mockOpenMessageDb([]),
    });

    expect(result.totalDeltas).toBe(0);
    expect(result.sources.opencode).toBe(0);
  });

  it("should gracefully handle when openMessageDb returns null", async () => {
    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const result = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: () => null,
    });

    expect(result.totalDeltas).toBe(0);
    expect(result.sources.opencode).toBe(0);
  });

  it("should not lose same-millisecond rows at the cursor boundary", async () => {
    // Two assistant messages at the exact same time_created.
    // After first sync processes both, the cursor should track
    // their IDs so the second sync doesn't re-process them.
    const sameMs = 1739600000000;
    const rows = [
      { id: "msg_A", session_id: "ses_001", time_created: sameMs, data: sqliteRowData({ role: "assistant", input: 100, output: 50, timeCreated: sameMs }) },
      { id: "msg_B", session_id: "ses_001", time_created: sameMs, data: sqliteRowData({ role: "assistant", input: 200, output: 100, timeCreated: sameMs }) },
    ];

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    // First sync: both rows are new → 2 deltas
    const r1 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
    });
    expect(r1.totalDeltas).toBe(2);
    expect(r1.sources.opencode).toBe(2);

    // Second sync: cursor's lastTimeCreated == sameMs, lastProcessedIds == [msg_A, msg_B]
    // The >= query returns both rows again, but they're filtered out by prevProcessedIds
    const r2 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should process a new row at the same millisecond as the cursor boundary", async () => {
    const sameMs = 1739600000000;
    const rowsBatch1 = [
      { id: "msg_A", session_id: "ses_001", time_created: sameMs, data: sqliteRowData({ role: "assistant", input: 100, output: 50, timeCreated: sameMs }) },
    ];

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    // First sync: msg_A processed
    const r1 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rowsBatch1),
    });
    expect(r1.totalDeltas).toBe(1);

    // A new row arrives at the same millisecond (rare but possible)
    const rowsBatch2 = [
      ...rowsBatch1,
      { id: "msg_B", session_id: "ses_001", time_created: sameMs, data: sqliteRowData({ role: "assistant", input: 200, output: 100, timeCreated: sameMs }) },
    ];

    // Second sync: msg_A deduped, msg_B is new → 1 delta
    const r2 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rowsBatch2),
    });
    expect(r2.totalDeltas).toBe(1);
    expect(r2.sources.opencode).toBe(1);
  });

  it("should emit warning when DB exists but openMessageDb adapter is missing", async () => {
    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      // openMessageDb intentionally NOT provided
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
    });

    const warnEvent = events.find(
      (e) => e.source === "opencode-sqlite" && e.phase === "warn",
    );
    expect(warnEvent).toBeDefined();
    expect(warnEvent!.message).toContain("SQLite is not available");
  });

  it("should emit warning when openMessageDb returns null (DB can't be opened)", async () => {
    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: () => null,
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
    });

    const warnEvent = events.find(
      (e) => e.source === "opencode-sqlite" && e.phase === "warn",
    );
    expect(warnEvent).toBeDefined();
    expect(warnEvent!.message).toContain("Failed to open");
  });

  // ===== OpenClaw parse error branch (lines 446-454) =====

  it("should emit warning and continue when OpenClaw parser throws", async () => {
    // Good OpenClaw file
    const goodDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(goodDir, { recursive: true });
    await writeFile(
      join(goodDir, "session-good.jsonl"),
      openclawLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    // Bad OpenClaw file
    const badDir = join(dataDir, ".openclaw", "agents", "a2", "sessions");
    await mkdir(badDir, { recursive: true });
    await writeFile(
      join(badDir, "session-bad.jsonl"),
      openclawLine("2026-03-07T10:15:00.000Z", 3000, 400) + "\n",
    );

    // Spy on the parser to throw for the bad file
    const openclawParser = await import("../parsers/openclaw.js");
    const origParse = openclawParser.parseOpenClawFile;
    const spy = vi
      .spyOn(openclawParser, "parseOpenClawFile")
      .mockImplementation(async (opts) => {
        if (opts.filePath.includes("session-bad")) {
          throw new Error("Simulated openclaw parser crash");
        }
        return origParse(opts);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSync({
        stateDir,
        openclawDir: join(dataDir, ".openclaw"),
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good file data should still be synced
      expect(result.sources.openclaw).toBe(1);

      // Verify a warning was emitted for the bad file
      const warnEvents = events.filter(
        (e) => e.source === "openclaw" && e.phase === "warn",
      );
      expect(warnEvents).toHaveLength(1);
      expect(warnEvents[0].message).toContain("Simulated openclaw parser crash");
    } finally {
      spy.mockRestore();
    }
  });

  // ===== Codex parse error branch (lines 510-517) =====

  it("should emit warning and continue when Codex parser throws", async () => {
    // Good Codex file
    const goodDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(goodDir, { recursive: true });
    await writeFile(
      join(goodDir, "rollout-good.jsonl"),
      codexLines("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    // Bad Codex file
    await writeFile(
      join(goodDir, "rollout-bad.jsonl"),
      codexLines("2026-03-07T10:16:00.000Z", 3000, 400) + "\n",
    );

    // Spy on the parser to throw for the bad file
    const codexParser = await import("../parsers/codex.js");
    const origParse = codexParser.parseCodexFile;
    const spy = vi
      .spyOn(codexParser, "parseCodexFile")
      .mockImplementation(async (opts) => {
        if (opts.filePath.includes("rollout-bad")) {
          throw new Error("Simulated codex parser crash");
        }
        return origParse(opts);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSync({
        stateDir,
        codexSessionsDir: join(dataDir, ".codex", "sessions"),
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good file data should still be synced
      expect(result.sources.codex).toBe(1);

      // Verify a warning was emitted for the bad file
      const warnEvents = events.filter(
        (e) => e.source === "codex" && e.phase === "warn",
      );
      expect(warnEvents).toHaveLength(1);
      expect(warnEvents[0].message).toContain("Simulated codex parser crash");
    } finally {
      spy.mockRestore();
    }
  });

  // ===== Gemini parse error branch with onProgress (lines 198-203) =====

  it("should emit warning and continue when Gemini parser throws", async () => {
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-gem-err", "chats");
    await mkdir(geminiDir, { recursive: true });

    // Good file
    await writeFile(
      join(geminiDir, "session-good.json"),
      geminiSession("2026-03-07T11:00:00.000Z", 2000, 200),
    );

    // Bad file — will be forced to throw via spy
    await writeFile(
      join(geminiDir, "session-bad.json"),
      geminiSession("2026-03-07T12:00:00.000Z", 3000, 300),
    );

    const geminiParser = await import("../parsers/gemini.js");
    const origParse = geminiParser.parseGeminiFile;
    const spy = vi
      .spyOn(geminiParser, "parseGeminiFile")
      .mockImplementation(async (opts) => {
        if (opts.filePath.includes("session-bad")) {
          throw new Error("Simulated gemini parser crash");
        }
        return origParse(opts);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSync({
        stateDir,
        geminiDir: join(dataDir, ".gemini"),
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good file data should still be synced
      expect(result.sources.gemini).toBe(1);

      // Verify a warning was emitted for the bad file
      const warnEvents = events.filter(
        (e) => e.source === "gemini-cli" && e.phase === "warn",
      );
      expect(warnEvents).toHaveLength(1);
      expect(warnEvents[0].message).toContain("Simulated gemini parser crash");
    } finally {
      spy.mockRestore();
    }
  });

  // ===== OpenCode parse error branch with onProgress (lines 277-283) =====

  it("should emit warning and continue when OpenCode parser throws", async () => {
    const msgDir = join(dataDir, "opencode-err", "message");

    // Good file in a session dir
    const sesDir1 = join(msgDir, "ses_good");
    await mkdir(sesDir1, { recursive: true });
    await writeFile(join(sesDir1, "msg_001.json"), opencodeMsg(1741320000000, 100, 50));

    // Bad file in another session dir — will be forced to throw via spy
    const sesDir2 = join(msgDir, "ses_bad");
    await mkdir(sesDir2, { recursive: true });
    await writeFile(join(sesDir2, "msg_001.json"), opencodeMsg(1741321000000, 200, 100));

    const ocParser = await import("../parsers/opencode.js");
    const origParse = ocParser.parseOpenCodeFile;
    const spy = vi
      .spyOn(ocParser, "parseOpenCodeFile")
      .mockImplementation(async (opts) => {
        if (opts.filePath.includes("ses_bad")) {
          throw new Error("Simulated opencode parser crash");
        }
        return origParse(opts);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSync({
        stateDir,
        openCodeMessageDir: msgDir,
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good file data should still be synced
      expect(result.sources.opencode).toBeGreaterThanOrEqual(1);

      // Verify a warning was emitted for the bad file
      const warnEvents = events.filter(
        (e) => e.source === "opencode" && e.phase === "warn",
      );
      expect(warnEvents).toHaveLength(1);
      expect(warnEvents[0].message).toContain("Simulated opencode parser crash");
    } finally {
      spy.mockRestore();
    }
  });

  // ===== OpenCode file-level skip with onProgress (lines 264-268) =====

  it("should emit parse progress for OpenCode file-level skip on unchanged file", async () => {
    const msgDir = join(dataDir, "opencode-fskip", "message");
    const sesDir = join(msgDir, "ses_fskip");
    await mkdir(sesDir, { recursive: true });
    await writeFile(join(sesDir, "msg_001.json"), opencodeMsg(1741320000000, 100, 50));

    // First sync without onProgress to establish cursors
    await executeSync({
      stateDir,
      openCodeMessageDir: msgDir,
    });

    // Add a new file to the session dir to change dir mtime (but keep msg_001 unchanged)
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(sesDir, "msg_002.json"), opencodeMsg(1741320300000, 150, 75));

    // Second sync with onProgress — dir mtime changed, so dir is scanned.
    // msg_001 has same inode+mtime+size → file-level skip path fires.
    const events: Array<{ source: string; phase: string; current?: number; total?: number }> = [];
    const result = await executeSync({
      stateDir,
      openCodeMessageDir: msgDir,
      onProgress: (e) => events.push({
        source: e.source,
        phase: e.phase,
        current: e.current,
        total: e.total,
      }),
    });

    // msg_002 is new, so at least 1 delta from it
    expect(result.sources.opencode).toBeGreaterThanOrEqual(1);

    // Verify parse progress events were fired (both for skipped and parsed files)
    const parseEvents = events.filter(
      (e) => e.source === "opencode" && e.phase === "parse" && e.current !== undefined,
    );
    expect(parseEvents.length).toBeGreaterThanOrEqual(2); // at least 2 files
  });

  // ===== OpenCode SQLite onProgress for parse detail (lines 381-384) =====

  it("should emit parse progress for OpenCode SQLite data with onProgress", async () => {
    const dbDir = join(dataDir, "opencode-sqlprog");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: (_p: string) => ({
        queryMessages: (_lastTs: number) => [
          {
            id: "msg_sql_001",
            session_id: "ses_sql_001",
            role: "assistant",
            time_created: 1741320000000,
            data: JSON.stringify({
              role: "assistant",
              modelID: "claude-opus-4.6",
              time: { created: 1741320000000, completed: 1741320001000 },
              tokens: { total: 150, input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            }),
          },
        ],
        close: () => {},
      }),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
    });

    // Verify SQLite discover event
    const discoverEvents = events.filter(
      (e) => e.source === "opencode" && e.phase === "discover",
    );
    expect(discoverEvents).toHaveLength(1);

    // Verify SQLite parse progress event with delta details
    const parseEvents = events.filter(
      (e) => e.source === "opencode" && e.phase === "parse",
    );
    expect(parseEvents).toHaveLength(1);
    expect(parseEvents[0].message).toContain("Parsed");
    expect(parseEvents[0].message).toContain("deltas");
  });

  // ===== OpenCode SQLite with no rows at all (line 395: rawRows empty fallback) =====

  it("should handle empty SQLite queryMessages result gracefully", async () => {
    const dbDir = join(dataDir, "opencode-sqlempty");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const result = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: (_p: string) => ({
        queryMessages: (_lastTs: number) => [],
        close: () => {},
      }),
    });

    expect(result.totalDeltas).toBe(0);
    expect(result.sources.opencode).toBe(0);
  });

  // ===== Token inflation fix tests (Step 1 — overwrite + cursor-after-queue) =====

  it("should not inflate queue on cursor reset (full-scan overwrite)", async () => {
    // Scenario: sync once → delete cursors → sync again → queue should have
    // the same values as the first sync (not 2x).
    const claudeDir = join(dataDir, ".claude", "projects", "proj-inflate");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    // First sync
    const r1 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r1.totalRecords).toBe(1);

    // Read queue to check initial values
    const queueRaw1 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records1 = queueRaw1.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records1).toHaveLength(1);
    expect(records1[0].input_tokens).toBe(5000);
    expect(records1[0].output_tokens).toBe(800);

    // Delete cursors (simulate cursor reset)
    const { rm: rmFile } = await import("node:fs/promises");
    await rmFile(join(stateDir, "cursors.json"), { force: true });

    // Second sync — full-scan branch should overwrite, not accumulate
    const r2 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r2.totalRecords).toBe(1);

    // Queue should have the SAME values (not 2x)
    const queueRaw2 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records2 = queueRaw2.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records2).toHaveLength(1);
    expect(records2[0].input_tokens).toBe(5000);  // NOT 10000
    expect(records2[0].output_tokens).toBe(800);   // NOT 1600
  });

  it("should accumulate incremental syncs correctly (SUM branch)", async () => {
    // Scenario: two incremental syncs without upload → queue should
    // contain the SUM of both syncs' deltas.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-incr");
    await mkdir(claudeDir, { recursive: true });
    const filePath = join(claudeDir, "session.jsonl");
    await writeFile(
      filePath,
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // First sync
    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    // Append more data to the same file (same half-hour bucket)
    const existing = await readFile(filePath, "utf-8");
    await writeFile(
      filePath,
      existing + claudeLine("2026-03-07T10:20:00.000Z", 2000, 200) + "\n",
    );

    // Second sync — incremental branch should SUM old + new
    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    // Should be aggregated into one record with SUM
    const claudeRecs = records.filter((r) => r.source === "claude-code");
    expect(claudeRecs).toHaveLength(1);
    expect(claudeRecs[0].input_tokens).toBe(3000);  // 1000 + 2000
    expect(claudeRecs[0].output_tokens).toBe(300);   // 100 + 200
  });

  it("should not inflate on upload failure + cursor reset", async () => {
    // Scenario: sync → upload fails (offset not advanced) → cursor reset → sync again
    // Queue should have the fresh full-scan values, not accumulated garbage.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-upfail");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 4000, 600) + "\n",
    );

    // First sync
    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    // Simulate upload failure: don't advance offset, so queue still has data

    // Delete cursors
    const { rm: rmFile } = await import("node:fs/promises");
    await rmFile(join(stateDir, "cursors.json"), { force: true });

    // Second sync — full-scan should overwrite the stale queue
    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records).toHaveLength(1);
    expect(records[0].input_tokens).toBe(4000);  // NOT 8000
    expect(records[0].output_tokens).toBe(600);   // NOT 1200
  });

  it("should preserve cursor-after-queue write order (queue written before cursors)", async () => {
    // Verify the new write order: if queue.overwrite throws, cursors should
    // NOT be saved — so the next sync re-processes everything.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-order");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // Spy on LocalQueue.overwrite to throw (simulating crash during queue write)
    const localQueueModule = await import("../storage/local-queue.js");
    const spy = vi.spyOn(localQueueModule.LocalQueue.prototype, "overwrite")
      .mockRejectedValue(new Error("Simulated queue write crash"));

    try {
      await executeSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
      }).catch(() => {
        // Expected — queue write failed
      });
    } finally {
      spy.mockRestore();
    }

    // Cursors should NOT be saved (cursor-after-queue means queue crash
    // prevents cursor save)
    const { CursorStore } = await import("../storage/cursor-store.js");
    const cursorStore = new CursorStore(stateDir);
    const cursors = await cursorStore.load();
    expect(Object.keys(cursors.files)).toHaveLength(0);

    // Now run a normal sync — should process all data fresh
    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(result.totalDeltas).toBe(1);
    expect(result.totalRecords).toBe(1);
  });

  // ===== Bug A: Partial replay inflation (inode change on single file) =====

  it("should not inflate when a single file's inode changes (partial replay)", async () => {
    // Scenario: sync Claude file → file gets replaced (new inode, same content)
    // → sync again → queue should have same values (not 2x).
    // This tests the bug where a single driver's inode reset causes
    // partial replay that gets SUM'd with the existing queue.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-inode");
    await mkdir(claudeDir, { recursive: true });
    const filePath = join(claudeDir, "session.jsonl");
    const content = claudeLine("2026-03-07T10:15:00.000Z", 3000, 300) + "\n";
    await writeFile(filePath, content);

    // First sync
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });

    const queueRaw1 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records1 = queueRaw1.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records1).toHaveLength(1);
    expect(records1[0].input_tokens).toBe(3000);

    // Simulate inode change: delete and recreate file with same content
    // (On most filesystems, rm + create = new inode)
    const { rm: rmFile } = await import("node:fs/promises");
    await rmFile(filePath);
    await new Promise((r) => setTimeout(r, 50)); // ensure different mtime
    await writeFile(filePath, content);

    // Second sync — inode changed, driver will replay from offset 0
    // With the fix, sync should detect inode change → full rescan → overwrite
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });

    const queueRaw2 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records2 = queueRaw2.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records2).toHaveLength(1);
    expect(records2[0].input_tokens).toBe(3000);  // NOT 6000
    expect(records2[0].output_tokens).toBe(300);   // NOT 600
  });

  it("should not inflate when inode changes with multiple sources active", async () => {
    // Scenario: Claude + Gemini both synced. Claude file inode changes.
    // Queue should reflect correct values for BOTH sources.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-multi");
    await mkdir(claudeDir, { recursive: true });
    const claudePath = join(claudeDir, "session.jsonl");
    const claudeContent = claudeLine("2026-03-07T10:15:00.000Z", 3000, 300) + "\n";
    await writeFile(claudePath, claudeContent);

    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-multi", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-2026-03-07.json"),
      geminiSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );

    // First sync — both sources
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    // Simulate Claude file inode change
    const { rm: rmFile } = await import("node:fs/promises");
    await rmFile(claudePath);
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(claudePath, claudeContent);

    // Second sync
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const claude = records.find((r) => r.source === "claude-code");
    const gemini = records.find((r) => r.source === "gemini-cli");
    expect(claude).toBeDefined();
    expect(gemini).toBeDefined();
    expect(claude!.input_tokens).toBe(3000);  // NOT 6000
    expect(gemini!.input_tokens).toBe(2000);  // Preserved, not lost
  });

  // ===== Bug A2: Partial replay inflation (single cursor entry missing/corrupted) =====

  it("should not inflate when a single file's cursor entry is missing", async () => {
    // Scenario: sync Claude + Gemini → manually delete Claude cursor entry →
    // sync again → Claude driver replays from offset 0 (full file content)
    // In the old code, this runs through the incremental SUM branch → 2× inflation.
    // With the fix, sync should detect the missing cursor → full rescan → overwrite.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-cursor-miss");
    await mkdir(claudeDir, { recursive: true });
    const claudePath = join(claudeDir, "session.jsonl");
    await writeFile(
      claudePath,
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-cursor-miss", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-2026-03-07.json"),
      geminiSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );

    // First sync — both sources
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    // Verify initial queue state
    const queueRaw1 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records1 = queueRaw1.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const claude1 = records1.find((r) => r.source === "claude-code");
    const gemini1 = records1.find((r) => r.source === "gemini-cli");
    expect(claude1!.input_tokens).toBe(1000);
    expect(gemini1!.input_tokens).toBe(2000);

    // Tamper with cursors.json: delete only the Claude file cursor entry
    const cursorsPath = join(stateDir, "cursors.json");
    const cursorsData = JSON.parse(await readFile(cursorsPath, "utf-8"));
    const fileKeys = Object.keys(cursorsData.files);
    // Remove all entries matching the Claude file path
    for (const key of fileKeys) {
      if (key.includes("proj-cursor-miss") && key.includes(".claude")) {
        delete cursorsData.files[key];
      }
    }
    await writeFile(cursorsPath, JSON.stringify(cursorsData));

    // Second sync — Claude cursor is missing, Gemini cursor exists
    // Without fix: Claude replays from 0 → incremental SUM → 2000/200 (2×)
    // With fix: detects missing cursor → full rescan → overwrite → 1000/100
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    const queueRaw2 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records2 = queueRaw2.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const claude2 = records2.find((r) => r.source === "claude-code");
    const gemini2 = records2.find((r) => r.source === "gemini-cli");
    expect(claude2).toBeDefined();
    expect(gemini2).toBeDefined();
    expect(claude2!.input_tokens).toBe(1000);   // NOT 2000
    expect(claude2!.output_tokens).toBe(100);    // NOT 200
    expect(gemini2!.input_tokens).toBe(2000);    // Preserved
    expect(gemini2!.output_tokens).toBe(200);    // Preserved
  });

  it("should trigger one-time full rescan when upgrading from old cursors.json without knownFilePaths", async () => {
    // Scenario: existing cursors.json from pre-v1.6.0 lacks knownFilePaths.
    // First sync after upgrade should detect this and restart as full scan,
    // then populate knownFilePaths for future use.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-upgrade");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 5000, 500) + "\n",
    );

    // First sync — establishes cursors normally
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });

    // Simulate old cursors.json: remove knownFilePaths field
    const cursorsPath = join(stateDir, "cursors.json");
    const cursorsData = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(cursorsData.knownFilePaths).toBeDefined();
    delete cursorsData.knownFilePaths;
    await writeFile(cursorsPath, JSON.stringify(cursorsData));

    // Second sync — should detect missing knownFilePaths → full rescan
    // Queue should still have correct values (not inflated)
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });

    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records).toHaveLength(1);
    expect(records[0].input_tokens).toBe(5000);  // NOT 10000

    // Verify knownFilePaths was populated after the rescan
    const updatedCursors = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(updatedCursors.knownFilePaths).toBeDefined();
    expect(Object.keys(updatedCursors.knownFilePaths).length).toBeGreaterThan(0);
  });

  it("should allow genuinely new files without triggering rescan", async () => {
    // Scenario: sync Claude → add a new Gemini file → sync again.
    // The new Gemini file should be picked up in incremental mode (SUM),
    // NOT trigger a full rescan, because it's not in knownFilePaths.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-newfile");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // First sync — only Claude
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });

    const queueRaw1 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records1 = queueRaw1.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    expect(records1).toHaveLength(1);
    expect(records1[0].source).toBe("claude-code");
    expect(records1[0].input_tokens).toBe(1000);

    // Add a genuinely new Gemini file
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-newfile", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-2026-03-07.json"),
      geminiSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );

    // Second sync — Claude + Gemini, incremental
    const r2 = await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    // Should pick up only the new Gemini delta (Claude skipped, unchanged)
    expect(r2.totalDeltas).toBe(1);
    expect(r2.sources.gemini).toBe(1);
    expect(r2.sources.claude).toBe(0);

    // Queue should have both sources with correct values
    const queueRaw2 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records2 = queueRaw2.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const claude = records2.find((r) => r.source === "claude-code");
    const gemini = records2.find((r) => r.source === "gemini-cli");
    expect(claude!.input_tokens).toBe(1000);  // Preserved from first sync
    expect(gemini!.input_tokens).toBe(2000);  // New file, correctly SUM'd
  });

  // ===== Bug A2b: SQLite cursor entry lost (DB-based driver cursor-loss detection) =====

  it("should not inflate when openCodeSqlite cursor entry is lost but file cursors exist", async () => {
    // Scenario: sync Claude + OpenCode SQLite → manually delete openCodeSqlite
    // cursor entry → sync again → SQLite driver replays from rowId 0.
    // Without fix: incremental SUM → 2× inflation.
    // With fix: detects missing DB cursor via knownDbSources → full rescan → overwrite.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-dbcursor-loss");
    await mkdir(claudeDir, { recursive: true });
    const claudePath = join(claudeDir, "session.jsonl");
    await writeFile(
      claudePath,
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy-sqlite-db");

    const sqliteRows = [
      { id: "msg_001", session_id: "ses_001", time_created: 1739600000000, data: sqliteRowData({ role: "assistant", input: 500, output: 200, timeCreated: 1739600000000 }) },
    ];

    // First sync — both Claude (file) + OpenCode SQLite (DB)
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(sqliteRows),
    });

    // Verify initial queue state
    const queueRaw1 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records1 = queueRaw1.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const claude1 = records1.find((r) => r.source === "claude-code");
    const oc1 = records1.find((r) => r.source === "opencode");
    expect(claude1!.input_tokens).toBe(1000);
    expect(oc1!.input_tokens).toBe(500);

    // Verify knownDbSources was populated
    const cursorsPath = join(stateDir, "cursors.json");
    const cursorsData = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(cursorsData.knownDbSources).toBeDefined();
    expect(cursorsData.knownDbSources.openCodeSqlite).toBe(true);

    // Tamper: delete only the openCodeSqlite cursor entry (keep file cursors)
    delete cursorsData.openCodeSqlite;
    await writeFile(cursorsPath, JSON.stringify(cursorsData));

    // Second sync — SQLite cursor is missing, file cursors still exist
    // Without fix: SQLite replays from 0 → SUM → 1000/400 (2×)
    // With fix: detects missing DB cursor → full rescan → overwrite → 500/200
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(sqliteRows),
    });

    const queueRaw2 = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records2 = queueRaw2.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const claude2 = records2.find((r) => r.source === "claude-code");
    const oc2 = records2.find((r) => r.source === "opencode");
    expect(claude2).toBeDefined();
    expect(oc2).toBeDefined();
    expect(oc2!.input_tokens).toBe(500);   // NOT 1000
    expect(oc2!.output_tokens).toBe(200);   // NOT 400
    expect(claude2!.input_tokens).toBe(1000);  // Preserved
    expect(claude2!.output_tokens).toBe(100);  // Preserved
  });

  it("should backfill knownDbSources from existing openCodeSqlite cursor on upgrade", async () => {
    // Scenario: cursors.json has knownFilePaths (v1.6.0) but NOT knownDbSources
    // (pre-fix). If openCodeSqlite cursor exists, knownDbSources should be
    // backfilled without triggering a full rescan.
    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy-sqlite-db");

    const sqliteRows = [
      { id: "msg_001", session_id: "ses_001", time_created: 1739600000000, data: sqliteRowData({ role: "assistant", input: 500, output: 200, timeCreated: 1739600000000 }) },
    ];

    // First sync — establishes cursor with knownDbSources
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(sqliteRows),
    });

    // Simulate v1.6.0 cursors: has knownFilePaths but NOT knownDbSources
    const cursorsPath = join(stateDir, "cursors.json");
    const cursorsData = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(cursorsData.knownDbSources).toBeDefined();
    delete cursorsData.knownDbSources;
    // Ensure knownFilePaths exists (v1.6.0+)
    if (!cursorsData.knownFilePaths) cursorsData.knownFilePaths = {};
    await writeFile(cursorsPath, JSON.stringify(cursorsData));

    // Second sync — should backfill knownDbSources, not inflate
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(sqliteRows),
    });

    // Verify knownDbSources was backfilled
    const updatedCursors = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(updatedCursors.knownDbSources).toBeDefined();
    expect(updatedCursors.knownDbSources.openCodeSqlite).toBe(true);

    // Verify no inflation
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const oc = records.find((r) => r.source === "opencode");
    expect(oc!.input_tokens).toBe(500);  // NOT 1000
  });

  it("should trigger full rescan when knownDbSources is missing AND openCodeSqlite cursor already lost (upgrade edge case)", async () => {
    // Edge case: cursors.json has knownFilePaths (v1.6.0+) but NOT
    // knownDbSources, AND the openCodeSqlite cursor is already gone.
    // Without a full rescan, the SQLite driver replays from rowId 0 and
    // the incremental SUM branch doubles the totals.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-edge");
    await mkdir(claudeDir, { recursive: true });
    const claudePath = join(claudeDir, "session.jsonl");
    await writeFile(
      claudePath,
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy-sqlite-db");

    const sqliteRows = [
      { id: "msg_001", session_id: "ses_001", time_created: 1739600000000, data: sqliteRowData({ role: "assistant", input: 500, output: 200, timeCreated: 1739600000000 }) },
    ];

    // First sync — both Claude + OpenCode SQLite
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(sqliteRows),
    });

    // Simulate intermediate cursor state:
    //   - knownFilePaths present (v1.6.0+)
    //   - knownDbSources absent (pre-fix)
    //   - openCodeSqlite cursor already deleted (lost)
    const cursorsPath = join(stateDir, "cursors.json");
    const cursorsData = JSON.parse(await readFile(cursorsPath, "utf-8"));
    delete cursorsData.knownDbSources;
    delete cursorsData.openCodeSqlite;
    if (!cursorsData.knownFilePaths) cursorsData.knownFilePaths = {};
    await writeFile(cursorsPath, JSON.stringify(cursorsData));

    // Collect progress messages to verify full rescan was triggered
    const progressMessages: string[] = [];

    // Second sync — detects upgrade with lost DB cursor → full rescan
    // The rescan clears all cursors, so both Claude + SQLite are re-parsed
    // from scratch as a full scan (initialCursorEmpty = true).
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(sqliteRows),
      onProgress: (p) => progressMessages.push(p.message),
    });

    // Verify full rescan was triggered (not a silent backfill to {})
    expect(progressMessages.some((m) => m.includes("full rescan"))).toBe(true);

    // Verify no inflation — tokens should be exact, not doubled
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l) as QueueRecord);
    const oc = records.find((r) => r.source === "opencode");
    expect(oc!.input_tokens).toBe(500);    // NOT 1000 (inflated)
    expect(oc!.output_tokens).toBe(200);   // NOT 400 (inflated)

    // Verify knownDbSources is now populated after the rescan
    const updated = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(updated.knownDbSources).toBeDefined();
    expect(updated.knownDbSources.openCodeSqlite).toBe(true);
  });

  // ===== Bug B: No-op sync re-marking history as unread =====

  it("should not re-mark uploaded records as unread on no-op sync", async () => {
    // Scenario: sync → upload (advances offset) → sync again (no new data)
    // → queue offset should stay advanced (not reset to 0)
    // This tests the bug where a no-op sync overwrites queue and resets
    // offset to 0, causing the next upload to re-send everything.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-noop");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1100, 110) + "\n",
    );

    // First sync
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });

    // Simulate successful upload: advance offset to end of queue file
    const { LocalQueue } = await import("../storage/local-queue.js");
    const queue = new LocalQueue(stateDir);
    const { newOffset } = await queue.readFromOffset(0);
    await queue.saveOffset(newOffset);

    // Verify offset is now > 0
    const offsetAfterUpload = await queue.loadOffset();
    expect(offsetAfterUpload).toBeGreaterThan(0);

    // Second sync — no new data
    const r2 = await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);

    // Queue offset should NOT be reset to 0
    const offsetAfterNoop = await queue.loadOffset();
    expect(offsetAfterNoop).toBe(offsetAfterUpload);

    // Verify queue content is still there (not wiped)
    const { records } = await queue.readFromOffset(0);
    expect(records).toHaveLength(1);
    expect(records[0].input_tokens).toBe(1100);
  });

  it("should set queue offset to 0 after sync (ready for full upload read)", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-offset");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    // Verify queue offset is 0
    const { LocalQueue } = await import("../storage/local-queue.js");
    const queue = new LocalQueue(stateDir);
    const offset = await queue.loadOffset();
    expect(offset).toBe(0);
  });

  // ===== Dirty-key tracking (doc 24) =====

  it("should populate dirtyKeys with all bucket keys on full scan", async () => {
    // Full scan (empty cursors) → dirtyKeys should contain every bucket key
    const claudeDir = join(dataDir, ".claude", "projects", "proj-dk-full");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      [
        claudeLine("2026-03-07T10:15:00.000Z", 1000, 100),
        claudeLine("2026-03-07T11:15:00.000Z", 2000, 200),
      ].join("\n") + "\n",
    );

    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    const { LocalQueue } = await import("../storage/local-queue.js");
    const queue = new LocalQueue(stateDir);
    const dirtyKeys = await queue.loadDirtyKeys();

    // Should be an array (not undefined — we're past legacy)
    expect(dirtyKeys).toBeDefined();
    expect(dirtyKeys).toBeInstanceOf(Array);
    // Two distinct hour buckets → two dirty keys
    expect(dirtyKeys!.sort()).toEqual([
      "claude-code|glm-5|2026-03-07T10:00:00.000Z|dev-dk",
      "claude-code|glm-5|2026-03-07T11:00:00.000Z|dev-dk",
    ]);
  });

  it("should track only new bucket keys on incremental sync", async () => {
    // First sync → populates cursors; second sync with new data in a
    // different hour bucket → dirtyKeys should contain only the new bucket.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-dk-incr");
    await mkdir(claudeDir, { recursive: true });
    const filePath = join(claudeDir, "session.jsonl");
    await writeFile(
      filePath,
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // First sync (full scan)
    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    // Simulate successful upload: clear dirtyKeys
    const { LocalQueue } = await import("../storage/local-queue.js");
    const queue = new LocalQueue(stateDir);
    await queue.saveDirtyKeys([]);

    // Append new data in a DIFFERENT hour bucket
    const existing = await readFile(filePath, "utf-8");
    await writeFile(
      filePath,
      existing + claudeLine("2026-03-07T12:15:00.000Z", 3000, 300) + "\n",
    );

    // Second sync — incremental
    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    const dirtyKeys = await queue.loadDirtyKeys();
    expect(dirtyKeys).toBeDefined();
    // Only the NEW bucket key should be dirty (not the old 10:00 one)
    expect(dirtyKeys!).toEqual([
      "claude-code|glm-5|2026-03-07T12:00:00.000Z|dev-dk",
    ]);
  });

  it("should union new dirty keys with existing ones on incremental sync", async () => {
    // If dirtyKeys already has entries (e.g., upload hasn't run yet), a new
    // incremental sync should union (not replace) new keys into the set.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-dk-union");
    await mkdir(claudeDir, { recursive: true });
    const filePath = join(claudeDir, "session.jsonl");
    await writeFile(
      filePath,
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // First sync (full scan)
    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    // DON'T clear dirtyKeys — simulate no upload yet
    // dirtyKeys should have the 10:00 bucket from full scan

    // Append data in a NEW hour bucket
    const existing = await readFile(filePath, "utf-8");
    await writeFile(
      filePath,
      existing + claudeLine("2026-03-07T13:15:00.000Z", 4000, 400) + "\n",
    );

    // Second sync — incremental, dirtyKeys not cleared
    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    const { LocalQueue } = await import("../storage/local-queue.js");
    const queue = new LocalQueue(stateDir);
    const dirtyKeys = await queue.loadDirtyKeys();
    expect(dirtyKeys).toBeDefined();
    // Both the old and new bucket should be dirty
    expect(dirtyKeys!.sort()).toEqual([
      "claude-code|glm-5|2026-03-07T10:00:00.000Z|dev-dk",
      "claude-code|glm-5|2026-03-07T13:00:00.000Z|dev-dk",
    ]);
  });

  it("should not modify dirtyKeys on no-op sync (no new data)", async () => {
    // Sync with no changes → skip queue write entirely → dirtyKeys unchanged
    const claudeDir = join(dataDir, ".claude", "projects", "proj-dk-noop");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // First sync
    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    // Simulate upload cleared dirtyKeys
    const { LocalQueue } = await import("../storage/local-queue.js");
    const queue = new LocalQueue(stateDir);
    await queue.saveDirtyKeys([]);

    // Second sync — no new data
    const r2 = await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r2.totalRecords).toBe(0);

    // dirtyKeys should still be [] (not modified)
    const dirtyKeys = await queue.loadDirtyKeys();
    expect(dirtyKeys).toEqual([]);
  });

  it("should include existing-bucket key when incremental data lands in same bucket", async () => {
    // Incremental data in the SAME hour bucket as existing → that key must
    // appear in dirtyKeys even though the bucket already existed in the queue.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-dk-same");
    await mkdir(claudeDir, { recursive: true });
    const filePath = join(claudeDir, "session.jsonl");
    await writeFile(
      filePath,
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // First sync
    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    // Simulate upload
    const { LocalQueue } = await import("../storage/local-queue.js");
    const queue = new LocalQueue(stateDir);
    await queue.saveDirtyKeys([]);

    // Append more data in the SAME hour bucket
    const existing = await readFile(filePath, "utf-8");
    await writeFile(
      filePath,
      existing + claudeLine("2026-03-07T10:25:00.000Z", 2000, 200) + "\n",
    );

    // Second sync — incremental, same bucket
    await executeSync({
      stateDir,
      deviceId: "dev-dk",
      claudeDir: join(dataDir, ".claude"),
    });

    const dirtyKeys = await queue.loadDirtyKeys();
    expect(dirtyKeys).toBeDefined();
    // The existing bucket is dirty because its values changed
    expect(dirtyKeys!).toEqual([
      "claude-code|glm-5|2026-03-07T10:00:00.000Z|dev-dk",
    ]);
  });

  // ===== Hermes SQLite integration =====

  /**
   * Helper: create a mock openHermesDb factory that returns rows from an in-memory array.
   */
  function mockOpenHermesDb(rows: Array<{ id: string; model: string | null; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; reasoning_tokens: number }>) {
    return (_dbPath: string) => ({
      querySessions: () => rows,
      close: () => {},
    });
  }

  it("should sync Hermes SQLite data to queue", async () => {
    const rows = [
      { id: "ses-h1", model: "claude-sonnet-4", input_tokens: 5000, output_tokens: 800, cache_read_tokens: 100, cache_write_tokens: 50, reasoning_tokens: 0 },
    ];

    const dbDir = join(dataDir, "hermes");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.db");
    await writeFile(dbPath, "dummy");

    const result = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb(rows),
    });

    expect(result.totalDeltas).toBe(1);
    expect(result.sources.hermes).toBe(1);
    expect(result.totalRecords).toBeGreaterThanOrEqual(1);
  });

  it("should be incremental for Hermes SQLite (second sync with same data)", async () => {
    const rows = [
      { id: "ses-h1", model: "claude-sonnet-4", input_tokens: 5000, output_tokens: 800, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 },
    ];

    const dbDir = join(dataDir, "hermes");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.db");
    await writeFile(dbPath, "dummy");

    const r1 = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb(rows),
    });
    expect(r1.totalDeltas).toBe(1);

    // Second sync — same rows, no new deltas
    const r2 = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb(rows),
    });
    expect(r2.totalDeltas).toBe(0);
  });

  it("should warn when Hermes DB exists but openHermesDb is not provided", async () => {
    const dbDir = join(dataDir, "hermes");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];
    const result = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      // openHermesDb is NOT provided
      onProgress: (e) => events.push(e),
    });

    expect(result.sources.hermes).toBe(0);
    expect(events.some((e) => e.source === "hermes" && e.phase === "warn" && e.message?.includes("not available"))).toBe(true);
  });

  it("should warn when Hermes openHermesDb returns null (failed to open)", async () => {
    const dbDir = join(dataDir, "hermes");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];
    const result = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      openHermesDb: () => null, // factory returns null
      onProgress: (e) => events.push(e),
    });

    expect(result.sources.hermes).toBe(0);
    expect(events.some((e) => e.source === "hermes" && e.phase === "warn" && e.message?.includes("Failed to open"))).toBe(true);
  });

  it("should handle Hermes DB driver error gracefully (catch branch)", async () => {
    const dbDir = join(dataDir, "hermes");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];
    const result = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      openHermesDb: () => ({
        querySessions: () => { throw new Error("DB corrupted"); },
        close: () => {},
      }),
      onProgress: (e) => events.push(e),
    });

    expect(result.sources.hermes).toBe(0);
    expect(events.some((e) => e.source === "hermes" && e.phase === "warn" && e.message?.includes("Skipping"))).toBe(true);
  });

  it("should detect Hermes DB cursor loss and restart full scan", async () => {
    const rows = [
      { id: "ses-h1", model: "claude-sonnet-4", input_tokens: 5000, output_tokens: 800, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 },
    ];

    // Need a file-based source to make initialCursorEmpty = false after cursor corruption
    const claudeDir = join(dataDir, ".claude", "projects", "proj-loss");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    const dbDir = join(dataDir, "hermes");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.db");
    await writeFile(dbPath, "dummy");

    // First sync to establish cursor with both sources
    const r1 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb(rows),
    });
    expect(r1.totalDeltas).toBe(2); // 1 claude + 1 hermes

    // Corrupt cursor: remove hermesSqlite but keep knownDbSources
    const { CursorStore } = await import("../storage/cursor-store.js");
    const cursorStore = new CursorStore(stateDir);
    const cursors = await cursorStore.load();
    delete (cursors as Record<string, unknown>).hermesSqlite;
    await cursorStore.save(cursors);

    // Second sync should detect cursor loss and restart
    const events: Array<{ source: string; phase: string; message?: string }> = [];
    const r2 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb(rows),
      onProgress: (e) => events.push(e),
    });

    expect(events.some((e) => e.phase === "warn" && e.message?.includes("cursor entry lost"))).toBe(true);
    // After restart, should rescan all
    expect(r2.totalDeltas).toBeGreaterThanOrEqual(1);
  });

  it("should detect Hermes DB inode change and restart full scan", async () => {
    const rows = [
      { id: "ses-h1", model: "claude-sonnet-4", input_tokens: 5000, output_tokens: 800, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 },
    ];

    // Need a file-based source to make initialCursorEmpty = false
    const claudeDir = join(dataDir, ".claude", "projects", "proj-inode");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    const dbDir = join(dataDir, "hermes");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.db");
    await writeFile(dbPath, "dummy");

    // First sync
    const r1 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb(rows),
    });
    expect(r1.totalDeltas).toBe(2);

    // Tamper cursor: change the hermesSqlite inode to force mismatch
    const { CursorStore } = await import("../storage/cursor-store.js");
    const cursorStore = new CursorStore(stateDir);
    const cursors = await cursorStore.load();
    const hermesCursor = (cursors as Record<string, unknown>).hermesSqlite as Record<string, unknown>;
    hermesCursor.inode = 999999; // fake inode
    await cursorStore.save(cursors);

    const events: Array<{ source: string; phase: string; message?: string }> = [];
    const r2 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb(rows),
      onProgress: (e) => events.push(e),
    });

    expect(events.some((e) => e.phase === "warn" && e.message?.includes("inode changed"))).toBe(true);
    expect(r2.totalDeltas).toBeGreaterThanOrEqual(1);
  });

  it("should detect file cursor loss and trigger replay with progress events", async () => {
    // Setup two sources
    const claudeDir = join(dataDir, ".claude", "projects", "proj-file-loss");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-fl", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-fl.json"),
      geminiSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );

    // First sync
    const r1 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });
    expect(r1.totalDeltas).toBe(2);

    // Tamper: delete Claude file cursor but keep it in knownFilePaths
    const cursorsPath = join(stateDir, "cursors.json");
    const cursorsData = JSON.parse(await readFile(cursorsPath, "utf-8"));
    const fileKeys = Object.keys(cursorsData.files);
    for (const key of fileKeys) {
      if (key.includes("proj-file-loss") && key.includes(".claude")) {
        delete cursorsData.files[key];
      }
    }
    await writeFile(cursorsPath, JSON.stringify(cursorsData));

    // Second sync with onProgress — should capture cursor loss and replay events
    const events: Array<{ source: string; phase: string; message?: string }> = [];
    const r2 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
      onProgress: (e) => events.push(e),
    });

    // Should detect cursor loss and restart
    expect(events.some((e) => e.phase === "warn" && e.message?.includes("Cursor entry lost"))).toBe(true);
    expect(events.some((e) => e.phase === "warn" && e.message?.includes("Replay condition detected"))).toBe(true);
    // After restart, values should be correct (not inflated)
    expect(r2.totalDeltas).toBe(2);
  });
});

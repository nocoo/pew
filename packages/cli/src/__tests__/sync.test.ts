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

  // ===== All four sources in one run =====

  it("should fire progress events for all four sources", async () => {
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

    const events: Array<{ source: string; phase: string }> = [];

    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
      openCodeMessageDir: join(dataDir, "opencode", "message"),
      openclawDir: join(dataDir, ".openclaw"),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase }),
    });

    // Verify all four sources emit discover + parse events
    expect(events.some((e) => e.source === "claude-code" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "claude-code" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "gemini-cli" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "gemini-cli" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "opencode" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "opencode" && e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.source === "openclaw" && e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.source === "openclaw" && e.phase === "parse")).toBe(true);
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

  it("should save cursors before queue so crash after cursor save does not cause double-counting", async () => {
    // This test verifies that cursors are persisted BEFORE the queue,
    // so if the process crashes after cursor save but before queue write,
    // the next sync will NOT re-parse already-processed data.
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
    );

    // Import the LocalQueue module to spy on appendBatch
    const localQueueModule = await import("../storage/local-queue.js");
    const origAppendBatch = localQueueModule.LocalQueue.prototype.appendBatch;

    // First sync: let appendBatch throw AFTER the cursor should be saved
    // (simulating a crash between cursor save and queue write)
    let appendBatchCalled = false;
    const spy = vi.spyOn(localQueueModule.LocalQueue.prototype, "appendBatch")
      .mockImplementation(async function(this: InstanceType<typeof localQueueModule.LocalQueue>, _records) {
        appendBatchCalled = true;
        throw new Error("Simulated crash during queue write");
      });

    try {
      await executeSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
      }).catch(() => {
        // Expected to throw due to queue write failure
      });
    } finally {
      spy.mockRestore();
    }

    expect(appendBatchCalled).toBe(true);

    // Check if cursors were saved (they should be, because cursor save
    // should happen BEFORE queue write)
    const { CursorStore } = await import("../storage/cursor-store.js");
    const cursorStore = new CursorStore(stateDir);
    const cursors = await cursorStore.load();
    const cursorKeys = Object.keys(cursors.files);
    expect(cursorKeys.length).toBeGreaterThan(0); // cursors were persisted

    // Second sync: normal operation, should produce NO new deltas
    // because cursors already advanced past the data
    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    expect(result.totalDeltas).toBe(0);
    expect(result.totalRecords).toBe(0);

    // Queue should have 0 records: first sync's queue write was blocked
    // by our mock, and second sync found no new data to write.
    let queueRecordCount = 0;
    try {
      const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
      queueRecordCount = queueRaw.trim().split("\n").filter((l) => l.length > 0).length;
    } catch {
      // queue.jsonl doesn't exist — that's fine, means 0 records
    }
    expect(queueRecordCount).toBe(0);
  });

  it("should sync all four sources simultaneously", async () => {
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

    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
      openCodeMessageDir: join(dataDir, "opencode", "message"),
      openclawDir: join(dataDir, ".openclaw"),
    });

    expect(result.totalDeltas).toBe(4);
    expect(result.sources.claude).toBe(1);
    expect(result.sources.gemini).toBe(1);
    expect(result.sources.opencode).toBe(1);
    expect(result.sources.openclaw).toBe(1);
    expect(result.filesScanned.claude).toBe(1);
    expect(result.filesScanned.gemini).toBe(1);
    expect(result.filesScanned.opencode).toBe(1);
    expect(result.filesScanned.openclaw).toBe(1);
  });
});

/**
 * CLI E2E tests for @nocoo/zebra.
 *
 * Full pipeline integration tests that validate:
 * - Complete sync pipeline: discover → parse → aggregate → queue write
 * - File-system side effects (queue, cursors)
 * - Incrementality (second sync skips already-processed data)
 * - Multi-source sync orchestration
 * - Queue record schema compliance
 * - Status command accuracy after sync
 *
 * These tests use temp directories for full isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSync } from "../../commands/sync.js";
import { executeStatus } from "../../commands/status.js";

/** Create a Claude JSONL line */
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

/** Create a Gemini session JSON */
function geminiSession(ts: string, input: number, output: number): string {
  return JSON.stringify({
    sessionId: "ses-e2e",
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

/** Create an OpenCode message JSON */
function opencodeMsg(ts: number, input: number, output: number): string {
  return JSON.stringify({
    id: "msg_e2e_001",
    sessionID: "ses_e2e_001",
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

/** Create an OpenClaw JSONL line */
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

// ---------------------------------------------------------------------------
// Full pipeline: sync
// ---------------------------------------------------------------------------

describe("CLI E2E: sync pipeline", () => {
  let tempDir: string;
  let stateDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-e2e-sync-"));
    stateDir = join(tempDir, "state");
    dataDir = join(tempDir, "data");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should sync Claude data end-to-end and verify disk output", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-e2e");
    await mkdir(claudeDir, { recursive: true });
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
    expect(result.totalRecords).toBe(1); // same half-hour bucket
    expect(result.sources.claude).toBe(2);

    // Verify queue file on disk
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l));
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("claude-code");
    expect(records[0].model).toBe("glm-5");
    expect(records[0].input_tokens).toBe(3000);
    expect(records[0].output_tokens).toBe(300);
    expect(records[0].hour_start).toBe("2026-03-07T10:00:00.000Z");

    // Verify cursor state on disk
    const cursorsRaw = await readFile(join(stateDir, "cursors.json"), "utf-8");
    const cursors = JSON.parse(cursorsRaw);
    expect(cursors.version).toBe(1);
    expect(Object.keys(cursors.files)).toHaveLength(1);
    expect(cursors.updatedAt).toBeTruthy();
  });

  it("should sync all 4 sources simultaneously", async () => {
    // Claude
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    // Gemini
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-b", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-e2e.json"),
      geminiSession("2026-03-07T14:30:00.000Z", 3000, 200),
    );

    // OpenCode
    const ocDir = join(dataDir, "opencode", "message", "ses_e2e");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_e2e_001.json"),
      opencodeMsg(1771120749059, 14967, 437),
    );

    // OpenClaw
    const ocwDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(ocwDir, { recursive: true });
    await writeFile(
      join(ocwDir, "session.jsonl"),
      openclawLine("2026-03-07T16:00:00.000Z", 4000, 500) + "\n",
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

    // All 4 sources in queue
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l));
    const sources = new Set(records.map((r: any) => r.source));
    expect(sources.has("claude-code")).toBe(true);
    expect(sources.has("gemini-cli")).toBe(true);
    expect(sources.has("opencode")).toBe(true);
    expect(sources.has("openclaw")).toBe(true);
  });

  it("should be fully incremental — second sync produces zero new records", async () => {
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
    expect(r1.totalRecords).toBe(1);

    const r2 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r2.totalDeltas).toBe(0);
    expect(r2.totalRecords).toBe(0);

    // Queue should still have exactly 1 record (no duplication)
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n");
    expect(records).toHaveLength(1);
  });

  it("should pick up new data appended after first sync", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    const filePath = join(claudeDir, "session.jsonl");

    await writeFile(filePath, claudeLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n");

    const r1 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r1.totalDeltas).toBe(1);

    // Append new data
    const { appendFile } = await import("node:fs/promises");
    await appendFile(filePath, claudeLine("2026-03-07T10:45:00.000Z", 3000, 400) + "\n");

    const r2 = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r2.totalDeltas).toBe(1);
    expect(r2.totalRecords).toBe(1);

    // Queue should now have 2 records total
    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n");
    expect(records).toHaveLength(2);
  });

  it("should handle empty / non-existent data directories gracefully", async () => {
    const result = await executeSync({ stateDir });
    expect(result.totalDeltas).toBe(0);
    expect(result.totalRecords).toBe(0);
    expect(result.sources.claude).toBe(0);
    expect(result.sources.gemini).toBe(0);
    expect(result.sources.opencode).toBe(0);
    expect(result.sources.openclaw).toBe(0);
  });

  it("should fire progress events during sync", async () => {
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
      onProgress(event) {
        events.push({ source: event.source, phase: event.phase });
      },
    });

    // Should have discover, parse, aggregate, and done phases
    expect(events.some((e) => e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.phase === "parse")).toBe(true);
    expect(events.some((e) => e.phase === "aggregate")).toBe(true);
    expect(events.some((e) => e.phase === "done")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: status after sync
// ---------------------------------------------------------------------------

describe("CLI E2E: status after sync", () => {
  let tempDir: string;
  let stateDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-e2e-status-"));
    stateDir = join(tempDir, "state");
    dataDir = join(tempDir, "data");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return clean status with no prior sync", async () => {
    const result = await executeStatus({ stateDir });
    expect(result.trackedFiles).toBe(0);
    expect(result.lastSync).toBeNull();
    expect(result.pendingRecords).toBe(0);
    expect(result.sources).toEqual({});
  });

  it("should accurately reflect state after multi-source sync", async () => {
    // Claude (2 files)
    for (const proj of ["proj-a", "proj-b"]) {
      const dir = join(dataDir, ".claude", "projects", proj);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "session.jsonl"),
        claudeLine("2026-03-07T10:15:00.000Z", 1000, 100) + "\n",
      );
    }

    // Gemini (1 file)
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-c", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-e2e.json"),
      geminiSession("2026-03-07T14:30:00.000Z", 2000, 150),
    );

    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    const result = await executeStatus({ stateDir });
    expect(result.trackedFiles).toBe(3); // 2 Claude + 1 Gemini
    expect(result.lastSync).toBeTruthy();
    expect(result.pendingRecords).toBeGreaterThan(0);
    expect(result.sources["claude-code"]).toBe(2);
    expect(result.sources["gemini-cli"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Queue record schema validation
// ---------------------------------------------------------------------------

describe("CLI E2E: queue record schema validation", () => {
  let tempDir: string;
  let stateDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-e2e-schema-"));
    stateDir = join(tempDir, "state");
    dataDir = join(tempDir, "data");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should produce records compliant with QueueRecord schema", async () => {
    // Set up multi-source data for thorough validation
    const claudeDir = join(dataDir, ".claude", "projects", "proj-a");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      claudeLine("2026-03-07T10:15:00.000Z", 5000, 800) + "\n",
    );

    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-b", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-e2e.json"),
      geminiSession("2026-03-07T14:30:00.000Z", 2000, 150),
    );

    const ocwDir = join(dataDir, ".openclaw", "agents", "a1", "sessions");
    await mkdir(ocwDir, { recursive: true });
    await writeFile(
      join(ocwDir, "session.jsonl"),
      openclawLine("2026-03-07T16:00:00.000Z", 4000, 500) + "\n",
    );

    await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
      openclawDir: join(dataDir, ".openclaw"),
    });

    const queueRaw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
    const records = queueRaw.trim().split("\n").map((l) => JSON.parse(l));
    expect(records.length).toBeGreaterThan(0);

    for (const record of records) {
      // All required fields present
      expect(record).toHaveProperty("source");
      expect(record).toHaveProperty("model");
      expect(record).toHaveProperty("hour_start");
      expect(record).toHaveProperty("input_tokens");
      expect(record).toHaveProperty("cached_input_tokens");
      expect(record).toHaveProperty("output_tokens");
      expect(record).toHaveProperty("reasoning_output_tokens");
      expect(record).toHaveProperty("total_tokens");

      // Correct types
      expect(typeof record.source).toBe("string");
      expect(typeof record.model).toBe("string");
      expect(typeof record.hour_start).toBe("string");
      expect(typeof record.input_tokens).toBe("number");
      expect(typeof record.cached_input_tokens).toBe("number");
      expect(typeof record.output_tokens).toBe("number");
      expect(typeof record.reasoning_output_tokens).toBe("number");
      expect(typeof record.total_tokens).toBe("number");

      // Valid source value
      expect(["claude-code", "gemini-cli", "opencode", "openclaw"]).toContain(
        record.source,
      );

      // Non-negative tokens
      expect(record.input_tokens).toBeGreaterThanOrEqual(0);
      expect(record.cached_input_tokens).toBeGreaterThanOrEqual(0);
      expect(record.output_tokens).toBeGreaterThanOrEqual(0);
      expect(record.reasoning_output_tokens).toBeGreaterThanOrEqual(0);
      expect(record.total_tokens).toBeGreaterThan(0);

      // Valid ISO 8601 half-hour boundary
      const date = new Date(record.hour_start);
      expect(date.getTime()).not.toBeNaN();
      expect(date.getMinutes() % 30).toBe(0);
      expect(date.getSeconds()).toBe(0);
      expect(date.getMilliseconds()).toBe(0);

      // total = input + output + reasoning
      expect(record.total_tokens).toBe(
        record.input_tokens + record.output_tokens + record.reasoning_output_tokens,
      );

      // Model is non-empty
      expect(record.model.length).toBeGreaterThan(0);

      // No extra unexpected fields
      const expectedKeys = new Set([
        "source", "model", "hour_start",
        "input_tokens", "cached_input_tokens", "output_tokens",
        "reasoning_output_tokens", "total_tokens",
      ]);
      for (const key of Object.keys(record)) {
        expect(expectedKeys.has(key)).toBe(true);
      }
    }
  });
});

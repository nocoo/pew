import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSessionSync, type SessionSyncResult } from "../commands/session-sync.js";
import type { SessionQueueRecord } from "@pew/core";

// ---------------------------------------------------------------------------
// Helpers: Claude JSONL lines
// ---------------------------------------------------------------------------

function claudeUserLine(ts: string, sessionId = "ses-001"): string {
  return JSON.stringify({
    type: "human",
    timestamp: ts,
    sessionId,
    message: { text: "hello" },
  });
}

function claudeAssistantLine(
  ts: string,
  sessionId = "ses-001",
  model = "claude-sonnet-4-20250514",
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    sessionId,
    message: {
      model,
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers: Gemini session JSON
// ---------------------------------------------------------------------------

function geminiSession(opts: {
  sessionId?: string;
  startTime?: string;
  lastUpdated?: string;
  projectHash?: string;
  messages: Array<{ type: string; timestamp: string; model?: string }>;
}): string {
  return JSON.stringify({
    sessionId: opts.sessionId ?? "gem-ses-001",
    startTime: opts.startTime,
    lastUpdated: opts.lastUpdated,
    projectHash: opts.projectHash ?? "gem-proj-hash",
    messages: opts.messages.map((m, i) => ({
      id: `msg-${i}`,
      type: m.type,
      timestamp: m.timestamp,
      ...(m.model ? { model: m.model } : {}),
    })),
  });
}

// ---------------------------------------------------------------------------
// Helpers: OpenCode message JSON
// ---------------------------------------------------------------------------

function opencodeMsg(opts: {
  sessionID?: string;
  role?: string;
  created: number;
  completed?: number;
  model?: string;
}): string {
  return JSON.stringify({
    id: `msg_${Date.now()}`,
    sessionID: opts.sessionID ?? "ses_oc001",
    role: opts.role ?? "assistant",
    modelID: opts.model ?? "claude-opus-4.6",
    time: {
      created: opts.created,
      completed: opts.completed ?? opts.created + 1000,
    },
    tokens: {
      total: 100,
      input: 80,
      output: 20,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers: OpenClaw JSONL lines
// ---------------------------------------------------------------------------

function openclawLine(
  ts: string,
  type: "message" | "system" | "tool" = "message",
  model = "claude-sonnet-4",
): string {
  return JSON.stringify({
    type,
    timestamp: ts,
    message:
      type === "message"
        ? {
            model,
            usage: {
              input: 100,
              cacheRead: 0,
              cacheWrite: 0,
              output: 50,
              totalTokens: 150,
            },
          }
        : undefined,
  });
}

// ---------------------------------------------------------------------------
// Helpers: parse queue file
// ---------------------------------------------------------------------------

async function readSessionQueue(
  stateDir: string,
): Promise<SessionQueueRecord[]> {
  let raw: string;
  try {
    raw = await readFile(join(stateDir, "session-queue.jsonl"), "utf-8");
  } catch {
    return [];
  }
  return raw
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SessionQueueRecord);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeSessionSync", () => {
  let tempDir: string;
  let dataDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-session-sync-"));
    dataDir = join(tempDir, "data");
    stateDir = join(tempDir, "state");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ----- Single-source sync -----

  it("should sync Claude session data to queue", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    const content = [
      claudeUserLine("2026-03-07T10:00:00.000Z"),
      claudeAssistantLine("2026-03-07T10:05:00.000Z"),
      claudeUserLine("2026-03-07T10:10:00.000Z"),
      claudeAssistantLine("2026-03-07T10:15:00.000Z"),
    ].join("\n") + "\n";
    await writeFile(join(claudeDir, "session.jsonl"), content);

    const result = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    expect(result.totalSnapshots).toBeGreaterThanOrEqual(1);
    expect(result.totalRecords).toBeGreaterThanOrEqual(1);
    expect(result.sources.claude).toBeGreaterThanOrEqual(1);

    const records = await readSessionQueue(stateDir);
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0].source).toBe("claude-code");
    expect(records[0].kind).toBe("human");
    expect(records[0].user_messages).toBe(2);
    expect(records[0].assistant_messages).toBe(2);
  });

  it("should sync Gemini session data to queue", async () => {
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-gem", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-2026-03-07.json"),
      geminiSession({
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

    const result = await executeSessionSync({
      stateDir,
      geminiDir: join(dataDir, ".gemini"),
    });

    expect(result.totalSnapshots).toBe(1);
    expect(result.sources.gemini).toBe(1);

    const records = await readSessionQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("gemini-cli");
    expect(records[0].kind).toBe("human");
  });

  it("should sync OpenCode session data to queue", async () => {
    const ocDir = join(dataDir, "opencode", "message", "ses_oc001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg({ role: "user", created: 1741320000000 }),
    );
    await writeFile(
      join(ocDir, "msg_002.json"),
      opencodeMsg({ role: "assistant", created: 1741320300000 }),
    );

    const result = await executeSessionSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });

    expect(result.totalSnapshots).toBe(1);
    expect(result.sources.opencode).toBe(1);

    const records = await readSessionQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("opencode");
    expect(records[0].kind).toBe("human");
  });

  it("should sync OpenClaw session data to queue", async () => {
    const agentDir = join(
      dataDir,
      ".openclaw",
      "agents",
      "agent-1",
      "sessions",
    );
    await mkdir(agentDir, { recursive: true });
    const content = [
      openclawLine("2026-03-07T10:00:00.000Z", "system"),
      openclawLine("2026-03-07T10:01:00.000Z", "message"),
      openclawLine("2026-03-07T10:05:00.000Z", "tool"),
      openclawLine("2026-03-07T10:10:00.000Z", "message"),
    ].join("\n") + "\n";
    await writeFile(join(agentDir, "session.jsonl"), content);

    const result = await executeSessionSync({
      stateDir,
      openclawDir: join(dataDir, ".openclaw"),
    });

    expect(result.totalSnapshots).toBe(1);
    expect(result.sources.openclaw).toBe(1);

    const records = await readSessionQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("openclaw");
    expect(records[0].kind).toBe("automated");
  });

  // ----- No data -----

  it("should handle no data directories at all", async () => {
    const result = await executeSessionSync({ stateDir });
    expect(result.totalSnapshots).toBe(0);
    expect(result.totalRecords).toBe(0);
  });

  // ----- Incremental: mtime+size skip -----

  it("should skip unchanged files on second sync (mtime+size dual-check)", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    const content = [
      claudeUserLine("2026-03-07T10:00:00.000Z"),
      claudeAssistantLine("2026-03-07T10:05:00.000Z"),
    ].join("\n") + "\n";
    await writeFile(join(claudeDir, "session.jsonl"), content);

    const r1 = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r1.totalSnapshots).toBeGreaterThanOrEqual(1);

    // Second sync: same file, unchanged
    const r2 = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r2.totalSnapshots).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should re-scan file when content changes (mtime+size change)", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    const filePath = join(claudeDir, "session.jsonl");

    const content1 = [
      claudeUserLine("2026-03-07T10:00:00.000Z"),
      claudeAssistantLine("2026-03-07T10:05:00.000Z"),
    ].join("\n") + "\n";
    await writeFile(filePath, content1);

    const r1 = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r1.totalSnapshots).toBeGreaterThanOrEqual(1);

    // Wait to ensure mtime differs, then append new data
    await new Promise((r) => setTimeout(r, 50));
    const content2 = content1 + [
      claudeUserLine("2026-03-07T10:20:00.000Z"),
      claudeAssistantLine("2026-03-07T10:25:00.000Z"),
    ].join("\n") + "\n";
    await writeFile(filePath, content2);

    const r2 = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });
    // File changed → full re-scan → should produce snapshots
    expect(r2.totalSnapshots).toBeGreaterThanOrEqual(1);
    expect(r2.totalRecords).toBeGreaterThanOrEqual(1);
  });

  // ----- Multi-source sync -----

  it("should sync multiple sources in one run", async () => {
    // Claude
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z"),
      ].join("\n") + "\n",
    );

    // Gemini
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-gem", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-2026-03-07.json"),
      geminiSession({
        messages: [
          { type: "user", timestamp: "2026-03-07T10:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T10:05:00.000Z" },
        ],
      }),
    );

    const result = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      geminiDir: join(dataDir, ".gemini"),
    });

    expect(result.sources.claude).toBeGreaterThanOrEqual(1);
    expect(result.sources.gemini).toBeGreaterThanOrEqual(1);
    expect(result.totalSnapshots).toBeGreaterThanOrEqual(2);
  });

  // ----- Dedup: latest snapshot per session_key -----

  it("should deduplicate session records (keep latest snapshot per session_key)", async () => {
    // Two Claude files, each containing the same sessionId — will produce
    // two snapshots with different snapshot_at. Dedup should keep only the latest.
    const projDir1 = join(dataDir, ".claude", "projects", "proj-a");
    const projDir2 = join(dataDir, ".claude", "projects", "proj-b");
    await mkdir(projDir1, { recursive: true });
    await mkdir(projDir2, { recursive: true });

    // Both files reference same sessionId
    await writeFile(
      join(projDir1, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z", "shared-session"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z", "shared-session"),
      ].join("\n") + "\n",
    );
    await writeFile(
      join(projDir2, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z", "shared-session"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z", "shared-session"),
        claudeUserLine("2026-03-07T10:10:00.000Z", "shared-session"),
        claudeAssistantLine("2026-03-07T10:15:00.000Z", "shared-session"),
      ].join("\n") + "\n",
    );

    const result = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    // Dedup keeps only one record per session_key
    const records = await readSessionQueue(stateDir);
    const sharedRecords = records.filter((r) =>
      r.session_key.includes("shared-session"),
    );
    expect(sharedRecords).toHaveLength(1);
  });

  // ----- Snapshot → QueueRecord field mapping -----

  it("should convert snapshot fields to snake_case queue record fields", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z"),
        claudeAssistantLine("2026-03-07T10:30:00.000Z"),
      ].join("\n") + "\n",
    );

    await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    const records = await readSessionQueue(stateDir);
    expect(records.length).toBeGreaterThanOrEqual(1);

    const r = records[0];
    // Verify snake_case fields exist and have correct types
    expect(typeof r.session_key).toBe("string");
    expect(typeof r.source).toBe("string");
    expect(typeof r.kind).toBe("string");
    expect(typeof r.started_at).toBe("string");
    expect(typeof r.last_message_at).toBe("string");
    expect(typeof r.duration_seconds).toBe("number");
    expect(typeof r.user_messages).toBe("number");
    expect(typeof r.assistant_messages).toBe("number");
    expect(typeof r.total_messages).toBe("number");
    expect(typeof r.snapshot_at).toBe("string");
    // project_ref and model can be null
    expect(r.project_ref === null || typeof r.project_ref === "string").toBe(
      true,
    );
    expect(r.model === null || typeof r.model === "string").toBe(true);
  });

  // ----- Cursor persistence -----

  it("should persist session cursors to disk", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z"),
      ].join("\n") + "\n",
    );

    await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
    });

    // Verify cursor file was created
    const cursorRaw = await readFile(
      join(stateDir, "session-cursors.json"),
      "utf-8",
    );
    const cursors = JSON.parse(cursorRaw);
    expect(cursors.version).toBe(1);
    expect(Object.keys(cursors.files).length).toBeGreaterThanOrEqual(1);

    // Each cursor should have mtimeMs and size
    const firstCursor = Object.values(cursors.files)[0] as Record<
      string,
      unknown
    >;
    expect(typeof firstCursor.mtimeMs).toBe("number");
    expect(typeof firstCursor.size).toBe("number");
  });

  // ----- OpenCode directory-level discovery -----

  it("should discover and process OpenCode session directories", async () => {
    // OpenCode uses one dir per session with msg_*.json files
    const sesDir1 = join(dataDir, "opencode", "message", "ses_001");
    const sesDir2 = join(dataDir, "opencode", "message", "ses_002");
    await mkdir(sesDir1, { recursive: true });
    await mkdir(sesDir2, { recursive: true });

    await writeFile(
      join(sesDir1, "msg_001.json"),
      opencodeMsg({ sessionID: "ses_001", role: "user", created: 1741320000000 }),
    );
    await writeFile(
      join(sesDir1, "msg_002.json"),
      opencodeMsg({ sessionID: "ses_001", role: "assistant", created: 1741320300000 }),
    );
    await writeFile(
      join(sesDir2, "msg_001.json"),
      opencodeMsg({ sessionID: "ses_002", role: "user", created: 1741321000000 }),
    );

    const result = await executeSessionSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
    });

    expect(result.totalSnapshots).toBe(2);
    expect(result.sources.opencode).toBe(2);

    const records = await readSessionQueue(stateDir);
    expect(records).toHaveLength(2);
    const keys = records.map((r) => r.session_key).sort();
    expect(keys[0]).toContain("ses_001");
    expect(keys[1]).toContain("ses_002");
  });

  // ----- Progress callback -----

  it("should call progress callback during sync", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z"),
      ].join("\n") + "\n",
    );

    const events: Array<{ source: string; phase: string }> = [];
    await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase }),
    });

    // Should have at least discover and done phases
    expect(events.some((e) => e.phase === "discover")).toBe(true);
    expect(events.some((e) => e.phase === "done")).toBe(true);
  });
});

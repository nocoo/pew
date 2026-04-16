import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSessionSync, type SessionSyncResult } from "../commands/session-sync.js";
import { SessionQueue } from "../storage/session-queue.js";
import { SessionCursorStore } from "../storage/session-cursor-store.js";
import type { SessionQueueRecord } from "@pew/core";

// ---------------------------------------------------------------------------
// Helpers: Claude JSONL lines
// ---------------------------------------------------------------------------

function claudeUserLine(ts: string, sessionId = "ses-001"): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    sessionId,
    message: { role: "user", content: "hello" },
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
// Helpers: Codex CLI JSONL lines
// ---------------------------------------------------------------------------

function codexSessionMeta(
  ts: string,
  sessionId = "ses-codex-001",
  cwd = "/tmp/project",
  model = "gpt-5.4",
): string {
  return JSON.stringify({
    timestamp: ts,
    type: "session_meta",
    payload: { id: sessionId, cwd, model },
  });
}

function codexTurnContext(ts: string, model = "gpt-5.4"): string {
  return JSON.stringify({
    timestamp: ts,
    type: "turn_context",
    payload: { model, cwd: "/tmp/project" },
  });
}

function codexResponseItem(
  ts: string,
  role: "user" | "assistant",
): string {
  return JSON.stringify({
    timestamp: ts,
    type: "response_item",
    payload: { role },
  });
}

function codexTokenCount(ts: string, input: number, output: number): string {
  return JSON.stringify({
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
}

// ---------------------------------------------------------------------------
// Helpers: Copilot CLI log lines
// ---------------------------------------------------------------------------

/**
 * Generate a minimal Copilot CLI process log with the given session UUID and request count.
 */
function copilotCliLog(opts: {
  sessionId: string;
  model?: string;
  requestCount?: number;
  startTs?: string;
}): string {
  const { sessionId, model = "claude-sonnet-4.6", requestCount = 1, startTs = "2026-03-07T10:00:00.000Z" } = opts;
  const lines: string[] = [];

  // Start timestamp
  lines.push(`${startTs} [INFO] Session indexing debug: SESSION_INDEXING=false`);
  lines.push(`${startTs} [INFO] Workspace initialized: ${sessionId} (checkpoints: 0)`);
  lines.push(`${startTs} [INFO] Using default model: ${model}`);

  // AI requests
  for (let i = 0; i < requestCount; i++) {
    const ts = startTs.replace(":00.000Z", `:${String(i + 1).padStart(2, "0")}.000Z`);
    lines.push(`${ts} [INFO] --- Start of group: Sending request to the AI model ---`);
    lines.push(`${ts} [INFO] --- End of group ---`);
  }

  return lines.join("\n") + "\n";
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
    expect(result.filesScanned.claude).toBe(1);

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
    expect(result.filesScanned.gemini).toBe(1);

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
    expect(result.filesScanned.opencode).toBe(1);

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
    expect(result.filesScanned.openclaw).toBe(1);

    const records = await readSessionQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("openclaw");
    expect(records[0].kind).toBe("automated");
  });

  it("should sync Codex CLI session data to queue", async () => {
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    const content = [
      codexSessionMeta("2026-03-07T10:00:00.000Z"),
      codexTurnContext("2026-03-07T10:00:01.000Z"),
      codexResponseItem("2026-03-07T10:01:00.000Z", "user"),
      codexResponseItem("2026-03-07T10:02:00.000Z", "assistant"),
      codexTokenCount("2026-03-07T10:02:01.000Z", 3000, 500),
      codexResponseItem("2026-03-07T10:05:00.000Z", "user"),
      codexResponseItem("2026-03-07T10:06:00.000Z", "assistant"),
      codexTokenCount("2026-03-07T10:06:01.000Z", 6000, 900),
    ].join("\n") + "\n";
    await writeFile(join(codexDir, "rollout-abc123.jsonl"), content);

    const result = await executeSessionSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });

    expect(result.totalSnapshots).toBe(1);
    expect(result.sources.codex).toBe(1);
    expect(result.filesScanned.codex).toBe(1);

    const records = await readSessionQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("codex");
    expect(records[0].kind).toBe("human");
    expect(records[0].session_key).toBe("codex:ses-codex-001");
    expect(records[0].user_messages).toBe(2);
    expect(records[0].assistant_messages).toBe(2);
    expect(records[0].model).toBe("gpt-5.4");
    expect(records[0].project_ref).toBe("f630ad93b344dd6b");
  });

  it("should skip unchanged Codex files on second sync", async () => {
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    const content = [
      codexSessionMeta("2026-03-07T10:00:00.000Z"),
      codexResponseItem("2026-03-07T10:01:00.000Z", "user"),
      codexResponseItem("2026-03-07T10:02:00.000Z", "assistant"),
    ].join("\n") + "\n";
    await writeFile(join(codexDir, "rollout-abc123.jsonl"), content);

    const r1 = await executeSessionSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });
    expect(r1.totalSnapshots).toBe(1);

    // Second sync: same file, unchanged
    const r2 = await executeSessionSync({
      stateDir,
      codexSessionsDir: join(dataDir, ".codex", "sessions"),
    });
    expect(r2.totalSnapshots).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  // ----- No data -----

  it("should handle no data directories at all", async () => {
    const result = await executeSessionSync({ stateDir });
    expect(result.totalSnapshots).toBe(0);
    expect(result.totalRecords).toBe(0);
    expect(result.filesScanned).toEqual({
      claude: 0, codex: 0, copilotCli: 0, gemini: 0, kosmos: 0, opencode: 0, openclaw: 0, pi: 0, pmstudio: 0,
    });
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
    await new Promise((r) => setTimeout(r, 1));
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
    expect(result.filesScanned.claude).toBe(1);
    expect(result.filesScanned.gemini).toBe(1);
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
    expect(result.filesScanned.opencode).toBe(2);

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

  // ===== OpenCode SQLite session integration =====

  /** Helper: mock openSessionDb factory */
  function mockOpenSessionDb(
    sessions: Array<{ id: string; project_id: string | null; title: string | null; time_created: number; time_updated: number }>,
    messages: Array<{ session_id: string; role: string; time_created: number; data: string }>,
  ) {
    return (_dbPath: string) => ({
      querySessions: (lastTimeUpdated: number) =>
        sessions.filter((s) => s.time_updated >= lastTimeUpdated),
      querySessionMessages: (sessionIds: string[]) =>
        messages.filter((m) => sessionIds.includes(m.session_id)),
      close: () => {},
    });
  }

  /** Helper: build message data JSON blob for SQLite session tests */
  function sqliteMsgData(opts: {
    role: string;
    modelID?: string;
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
        ? { total: 150, input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } }
        : null,
    });
  }

  it("should sync OpenCode SQLite sessions to queue", async () => {
    const sessions = [
      { id: "ses_sql_001", project_id: "proj_1", title: "Test session", time_created: 1739600000000, time_updated: 1739600600000 },
    ];
    const messages = [
      { session_id: "ses_sql_001", role: "user", time_created: 1739600000000, data: sqliteMsgData({ role: "user", timeCreated: 1739600000000 }) },
      { session_id: "ses_sql_001", role: "assistant", time_created: 1739600100000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600100000 }) },
      { session_id: "ses_sql_001", role: "user", time_created: 1739600200000, data: sqliteMsgData({ role: "user", timeCreated: 1739600200000 }) },
      { session_id: "ses_sql_001", role: "assistant", time_created: 1739600300000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600300000 }) },
    ];

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const result = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions, messages),
    });

    expect(result.totalSnapshots).toBe(1);
    expect(result.sources.opencode).toBe(1);
    expect(result.dbsScanned.opencode).toBe(1);

    const records = await readSessionQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0].source).toBe("opencode");
    expect(records[0].session_key).toBe("opencode:ses_sql_001");
    expect(records[0].user_messages).toBe(2);
    expect(records[0].assistant_messages).toBe(2);
    expect(records[0].total_messages).toBe(4);
    expect(records[0].project_ref).toBe("f8d5ee0ecbba1420"); // sha256("proj_1")[0:16]
  });

  it("should be incremental for OpenCode SQLite sessions (second sync with no new sessions)", async () => {
    const sessions = [
      { id: "ses_sql_001", project_id: null, title: null, time_created: 1739600000000, time_updated: 1739600600000 },
    ];
    const messages = [
      { session_id: "ses_sql_001", role: "user", time_created: 1739600000000, data: sqliteMsgData({ role: "user", timeCreated: 1739600000000 }) },
      { session_id: "ses_sql_001", role: "assistant", time_created: 1739600100000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600100000 }) },
    ];

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const factory = mockOpenSessionDb(sessions, messages);

    const r1 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: factory,
    });
    expect(r1.totalSnapshots).toBe(1);

    // Second sync: cursor has advanced, no new sessions
    const r2 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: factory,
    });
    expect(r2.totalSnapshots).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should gracefully skip when SQLite DB file does not exist for sessions", async () => {
    const result = await executeSessionSync({
      stateDir,
      openCodeDbPath: "/nonexistent/opencode.db",
      openSessionDb: mockOpenSessionDb([], []),
    });

    expect(result.totalSnapshots).toBe(0);
    expect(result.sources.opencode).toBe(0);
  });

  it("should sync both JSON and SQLite OpenCode sessions together", async () => {
    // JSON sessions
    const ocDir = join(dataDir, "opencode", "message", "ses_json001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg({ sessionID: "ses_json001", role: "user", created: 1741320000000 }),
    );
    await writeFile(
      join(ocDir, "msg_002.json"),
      opencodeMsg({ sessionID: "ses_json001", role: "assistant", created: 1741320300000 }),
    );

    // SQLite sessions (different session)
    const dbDir = join(dataDir, "opencode");
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const sessions = [
      { id: "ses_sql_002", project_id: null, title: null, time_created: 1741400000000, time_updated: 1741400600000 },
    ];
    const messages = [
      { session_id: "ses_sql_002", role: "user", time_created: 1741400000000, data: sqliteMsgData({ role: "user", timeCreated: 1741400000000 }) },
      { session_id: "ses_sql_002", role: "assistant", time_created: 1741400100000, data: sqliteMsgData({ role: "assistant", timeCreated: 1741400100000 }) },
    ];

    const result = await executeSessionSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode", "message"),
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions, messages),
    });

    // Should have sessions from both JSON and SQLite
    expect(result.sources.opencode).toBe(2);
    expect(result.totalSnapshots).toBe(2);
    // 1 JSON dir + 1 SQLite DB
    expect(result.filesScanned.opencode).toBe(1);
    expect(result.dbsScanned.opencode).toBe(1);

    const records = await readSessionQueue(stateDir);
    const keys = records.map((r) => r.session_key).sort();
    expect(keys).toContain("opencode:ses_json001");
    expect(keys).toContain("opencode:ses_sql_002");
  });

  // ===== Same-millisecond boundary dedup for SQLite sessions =====

  it("should not lose same-millisecond sessions at the cursor boundary", async () => {
    // Two sessions with the exact same time_updated.
    // After first sync processes both, the cursor should track
    // their IDs so the second sync doesn't re-process them.
    const sameMs = 1739600600000;
    const sessions = [
      { id: "ses_A", project_id: null, title: null, time_created: 1739600000000, time_updated: sameMs },
      { id: "ses_B", project_id: null, title: null, time_created: 1739600100000, time_updated: sameMs },
    ];
    const messages = [
      { session_id: "ses_A", role: "user", time_created: 1739600000000, data: sqliteMsgData({ role: "user", timeCreated: 1739600000000 }) },
      { session_id: "ses_A", role: "assistant", time_created: 1739600100000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600100000 }) },
      { session_id: "ses_B", role: "user", time_created: 1739600200000, data: sqliteMsgData({ role: "user", timeCreated: 1739600200000 }) },
      { session_id: "ses_B", role: "assistant", time_created: 1739600300000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600300000 }) },
    ];

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    // First sync: both sessions are new → 2 snapshots
    const r1 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions, messages),
    });
    expect(r1.totalSnapshots).toBe(2);
    expect(r1.sources.opencode).toBe(2);

    // Second sync: cursor's lastTimeUpdated == sameMs, lastProcessedIds == [ses_A, ses_B]
    // The >= query returns both again, but they're filtered out by prevProcessedIds
    const r2 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions, messages),
    });
    expect(r2.totalSnapshots).toBe(0);
    expect(r2.totalRecords).toBe(0);
  });

  it("should process a new session at the same millisecond as the cursor boundary", async () => {
    const sameMs = 1739600600000;
    const sessionsBatch1 = [
      { id: "ses_A", project_id: null, title: null, time_created: 1739600000000, time_updated: sameMs },
    ];
    const messagesBatch1 = [
      { session_id: "ses_A", role: "user", time_created: 1739600000000, data: sqliteMsgData({ role: "user", timeCreated: 1739600000000 }) },
      { session_id: "ses_A", role: "assistant", time_created: 1739600100000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600100000 }) },
    ];

    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    // First sync: ses_A processed
    const r1 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessionsBatch1, messagesBatch1),
    });
    expect(r1.totalSnapshots).toBe(1);

    // A new session arrives with the same time_updated (rare but possible)
    const sessionsBatch2 = [
      ...sessionsBatch1,
      { id: "ses_B", project_id: null, title: null, time_created: 1739600200000, time_updated: sameMs },
    ];
    const messagesBatch2 = [
      ...messagesBatch1,
      { session_id: "ses_B", role: "user", time_created: 1739600200000, data: sqliteMsgData({ role: "user", timeCreated: 1739600200000 }) },
      { session_id: "ses_B", role: "assistant", time_created: 1739600300000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600300000 }) },
    ];

    // Second sync: ses_A deduped, ses_B is new → 1 snapshot
    const r2 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessionsBatch2, messagesBatch2),
    });
    expect(r2.totalSnapshots).toBe(1);
    expect(r2.sources.opencode).toBe(1);
  });

  // ===== Warning emissions for SQLite sessions =====

  it("should emit warning when DB exists but openSessionDb adapter is missing", async () => {
    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      // openSessionDb intentionally NOT provided
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
    });

    const warnEvent = events.find(
      (e) => e.source === "opencode-sqlite" && e.phase === "warn",
    );
    expect(warnEvent).toBeDefined();
    expect(warnEvent!.message).toContain("SQLite is not available");
  });

  it("should emit warning when openSessionDb returns null (DB can't be opened)", async () => {
    const dbDir = join(dataDir, "opencode");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: () => null,
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
    });

    const warnEvent = events.find(
      (e) => e.source === "opencode-sqlite" && e.phase === "warn",
    );
    expect(warnEvent).toBeDefined();
    expect(warnEvent!.message).toContain("Failed to open");
  });

  // ----- Codex parse error branch (lines 528-549) -----

  it("should emit warning and continue when Codex session parser throws", async () => {
    const codexDir = join(dataDir, ".codex", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });

    // Good file
    const goodContent = [
      codexSessionMeta("2026-03-07T10:00:00.000Z"),
      codexResponseItem("2026-03-07T10:01:00.000Z", "user"),
      codexResponseItem("2026-03-07T10:02:00.000Z", "assistant"),
    ].join("\n") + "\n";
    await writeFile(join(codexDir, "rollout-good.jsonl"), goodContent);

    // Bad file — valid JSONL content but will be forced to throw via spy
    await writeFile(join(codexDir, "rollout-bad.jsonl"), goodContent);

    // Spy on the parser to throw for the bad file
    const codexParser = await import("../parsers/codex-session.js");
    const origCollect = codexParser.collectCodexSessions;
    const spy = vi
      .spyOn(codexParser, "collectCodexSessions")
      .mockImplementation(async (filePath) => {
        if (filePath.includes("rollout-bad")) {
          throw new Error("Simulated codex session parser crash");
        }
        return origCollect(filePath);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSessionSync({
        stateDir,
        codexSessionsDir: join(dataDir, ".codex", "sessions"),
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // The good file's data should still be synced
      expect(result.sources.codex).toBeGreaterThanOrEqual(1);

      // Verify a warning was emitted for the bad file
      const warnEvents = events.filter(
        (e) => e.source === "codex" && e.phase === "warn",
      );
      expect(warnEvents).toHaveLength(1);
      expect(warnEvents[0].message).toContain("Simulated codex session parser crash");

      // Verify parse progress was still reported for both files
      const parseEvents = events.filter(
        (e) => e.source === "codex" && e.phase === "parse" && e.message === undefined,
      );
      expect(parseEvents.length).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  // ===== Comprehensive onProgress coverage for ALL sources =====

  it("should call onProgress for all phases across all sources", async () => {
    // --- Claude ---
    const claudeDir = join(dataDir, ".claude", "projects", "proj-prog");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z"),
      ].join("\n") + "\n",
    );

    // --- Gemini ---
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-gem-prog", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-prog.json"),
      geminiSession({
        sessionId: "gem-prog-001",
        messages: [
          { type: "user", timestamp: "2026-03-07T11:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T11:05:00.000Z", model: "gemini-2.5-pro" },
        ],
      }),
    );

    // --- OpenCode ---
    const ocDir = join(dataDir, "opencode-prog", "message", "ses_prog001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg({ sessionID: "ses_prog001", role: "user", created: 1741320000000 }),
    );
    await writeFile(
      join(ocDir, "msg_002.json"),
      opencodeMsg({ sessionID: "ses_prog001", role: "assistant", created: 1741320300000 }),
    );

    // --- OpenClaw ---
    const openclawAgentDir = join(dataDir, ".openclaw-prog", "agents", "agent-prog", "sessions");
    await mkdir(openclawAgentDir, { recursive: true });
    await writeFile(
      join(openclawAgentDir, "session-prog.jsonl"),
      [
        openclawLine("2026-03-07T12:00:00.000Z", "system"),
        openclawLine("2026-03-07T12:01:00.000Z", "message"),
        openclawLine("2026-03-07T12:05:00.000Z", "message"),
      ].join("\n") + "\n",
    );

    // --- Codex ---
    const codexDir = join(dataDir, ".codex-prog", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "rollout-prog.jsonl"),
      [
        codexSessionMeta("2026-03-07T13:00:00.000Z", "ses-codex-prog"),
        codexResponseItem("2026-03-07T13:01:00.000Z", "user"),
        codexResponseItem("2026-03-07T13:02:00.000Z", "assistant"),
      ].join("\n") + "\n",
    );

    // --- Copilot CLI ---
    const copilotDir = join(dataDir, ".copilot-prog", "logs");
    await mkdir(copilotDir, { recursive: true });
    await writeFile(
      join(copilotDir, "process-123456-789.log"),
      copilotCliLog({
        sessionId: "11111111-2222-3333-4444-555555555555",
        model: "claude-sonnet-4.6",
        requestCount: 2,
        startTs: "2026-03-07T14:00:00.000Z",
      }),
    );

    const events: Array<{ source: string; phase: string; current?: number; total?: number; message?: string }> = [];

    const result = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      codexSessionsDir: join(dataDir, ".codex-prog", "sessions"),
      copilotCliLogsDir: join(dataDir, ".copilot-prog", "logs"),
      geminiDir: join(dataDir, ".gemini"),
      openCodeMessageDir: join(dataDir, "opencode-prog", "message"),
      openclawDir: join(dataDir, ".openclaw-prog"),
      onProgress: (e) => events.push({
        source: e.source,
        phase: e.phase,
        current: e.current,
        total: e.total,
        message: e.message,
      }),
    });

    // Verify all sources produced snapshots
    expect(result.sources.claude).toBeGreaterThanOrEqual(1);
    expect(result.sources.codex).toBe(1);
    expect(result.sources.copilotCli).toBe(1);
    expect(result.sources.gemini).toBe(1);
    expect(result.sources.opencode).toBe(1);
    expect(result.sources.openclaw).toBe(1);

    // Verify progress events were emitted for each source
    for (const source of ["claude-code", "codex", "copilot-cli", "gemini-cli", "opencode", "openclaw"]) {
      const sourceEvents = events.filter((e) => e.source === source);
      expect(sourceEvents.some((e) => e.phase === "discover"), `${source} should have discover`).toBe(true);
      expect(sourceEvents.some((e) => e.phase === "parse"), `${source} should have parse`).toBe(true);

      // Verify parse events have current/total for the file loop
      const parseWithProgress = sourceEvents.filter(
        (e) => e.phase === "parse" && e.current !== undefined,
      );
      expect(parseWithProgress.length, `${source} should have parse with current`).toBeGreaterThanOrEqual(1);
    }

    // Verify dedup and done events
    expect(events.some((e) => e.source === "all" && e.phase === "dedup")).toBe(true);
    expect(events.some((e) => e.source === "all" && e.phase === "done")).toBe(true);
  });

  // ===== onProgress for unchanged-file skip across all file-based sources =====

  it("should emit parse progress for skipped unchanged files (all sources with onProgress)", async () => {
    // --- Claude ---
    const claudeDir = join(dataDir, ".claude", "projects", "proj-skip");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, "session.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z"),
      ].join("\n") + "\n",
    );

    // --- Gemini ---
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-gem-skip", "chats");
    await mkdir(geminiDir, { recursive: true });
    await writeFile(
      join(geminiDir, "session-skip.json"),
      geminiSession({
        sessionId: "gem-skip-001",
        messages: [
          { type: "user", timestamp: "2026-03-07T11:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T11:05:00.000Z" },
        ],
      }),
    );

    // --- OpenCode ---
    const ocDir = join(dataDir, "opencode-skip", "message", "ses_skip001");
    await mkdir(ocDir, { recursive: true });
    await writeFile(
      join(ocDir, "msg_001.json"),
      opencodeMsg({ sessionID: "ses_skip001", role: "user", created: 1741320000000 }),
    );

    // --- OpenClaw ---
    const openclawAgentDir = join(dataDir, ".openclaw-skip", "agents", "agent-skip", "sessions");
    await mkdir(openclawAgentDir, { recursive: true });
    await writeFile(
      join(openclawAgentDir, "session-skip.jsonl"),
      [
        openclawLine("2026-03-07T12:00:00.000Z", "system"),
        openclawLine("2026-03-07T12:01:00.000Z", "message"),
      ].join("\n") + "\n",
    );

    // --- Codex ---
    const codexDir = join(dataDir, ".codex-skip", "sessions", "2026", "03", "07");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "rollout-skip.jsonl"),
      [
        codexSessionMeta("2026-03-07T13:00:00.000Z", "ses-codex-skip"),
        codexResponseItem("2026-03-07T13:01:00.000Z", "user"),
        codexResponseItem("2026-03-07T13:02:00.000Z", "assistant"),
      ].join("\n") + "\n",
    );

    // --- Copilot CLI ---
    const copilotDir = join(dataDir, ".copilot-skip", "logs");
    await mkdir(copilotDir, { recursive: true });
    await writeFile(
      join(copilotDir, "process-skip-123.log"),
      copilotCliLog({
        sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        requestCount: 1,
        startTs: "2026-03-07T14:00:00.000Z",
      }),
    );

    // First sync (no onProgress) — establishes cursors
    await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      codexSessionsDir: join(dataDir, ".codex-skip", "sessions"),
      copilotCliLogsDir: join(dataDir, ".copilot-skip", "logs"),
      geminiDir: join(dataDir, ".gemini"),
      openCodeMessageDir: join(dataDir, "opencode-skip", "message"),
      openclawDir: join(dataDir, ".openclaw-skip"),
    });

    // Second sync WITH onProgress — files unchanged → skip branches fire
    const events: Array<{ source: string; phase: string; current?: number; total?: number }> = [];
    const r2 = await executeSessionSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      codexSessionsDir: join(dataDir, ".codex-skip", "sessions"),
      copilotCliLogsDir: join(dataDir, ".copilot-skip", "logs"),
      geminiDir: join(dataDir, ".gemini"),
      openCodeMessageDir: join(dataDir, "opencode-skip", "message"),
      openclawDir: join(dataDir, ".openclaw-skip"),
      onProgress: (e) => events.push({
        source: e.source,
        phase: e.phase,
        current: e.current,
        total: e.total,
      }),
    });

    // No new snapshots since files are unchanged
    expect(r2.totalSnapshots).toBe(0);

    // Verify skip-path parse progress was emitted for each file-based source
    for (const source of ["claude-code", "codex", "copilot-cli", "gemini-cli", "openclaw"]) {
      const skipParseEvents = events.filter(
        (e) => e.source === source && e.phase === "parse" && e.current !== undefined,
      );
      expect(
        skipParseEvents.length,
        `${source} should emit parse progress for unchanged files`,
      ).toBeGreaterThanOrEqual(1);
    }

    // OpenCode uses mtime-only check for dirs — verify skip progress
    const ocSkipEvents = events.filter(
      (e) => e.source === "opencode" && e.phase === "parse" && e.current !== undefined,
    );
    expect(ocSkipEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ===== Parse error tests for Gemini, OpenCode, OpenClaw =====

  it("should emit warning and continue when Gemini session parser throws", async () => {
    const geminiDir = join(dataDir, ".gemini", "tmp", "proj-gem-err", "chats");
    await mkdir(geminiDir, { recursive: true });

    // Good file
    await writeFile(
      join(geminiDir, "session-good.json"),
      geminiSession({
        sessionId: "gem-good",
        messages: [
          { type: "user", timestamp: "2026-03-07T11:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T11:05:00.000Z" },
        ],
      }),
    );

    // Bad file — will be forced to throw via spy
    await writeFile(
      join(geminiDir, "session-bad.json"),
      geminiSession({
        sessionId: "gem-bad",
        messages: [
          { type: "user", timestamp: "2026-03-07T12:00:00.000Z" },
          { type: "gemini", timestamp: "2026-03-07T12:05:00.000Z" },
        ],
      }),
    );

    const geminiParser = await import("../parsers/gemini-session.js");
    const origCollect = geminiParser.collectGeminiSessions;
    const spy = vi
      .spyOn(geminiParser, "collectGeminiSessions")
      .mockImplementation(async (filePath) => {
        if (filePath.includes("session-bad")) {
          throw new Error("Simulated gemini parser crash");
        }
        return origCollect(filePath);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSessionSync({
        stateDir,
        geminiDir: join(dataDir, ".gemini"),
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good file's data should still be synced
      expect(result.sources.gemini).toBeGreaterThanOrEqual(1);

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

  it("should emit warning and continue when OpenCode session parser throws", async () => {
    const msgDir = join(dataDir, "opencode-err", "message");

    // Good dir
    const goodDir = join(msgDir, "ses_good");
    await mkdir(goodDir, { recursive: true });
    await writeFile(
      join(goodDir, "msg_001.json"),
      opencodeMsg({ sessionID: "ses_good", role: "user", created: 1741320000000 }),
    );
    await writeFile(
      join(goodDir, "msg_002.json"),
      opencodeMsg({ sessionID: "ses_good", role: "assistant", created: 1741320300000 }),
    );

    // Bad dir — will be forced to throw via spy
    const badDir = join(msgDir, "ses_bad");
    await mkdir(badDir, { recursive: true });
    await writeFile(
      join(badDir, "msg_001.json"),
      opencodeMsg({ sessionID: "ses_bad", role: "user", created: 1741321000000 }),
    );

    const ocParser = await import("../parsers/opencode-session.js");
    const origCollect = ocParser.collectOpenCodeSessions;
    const spy = vi
      .spyOn(ocParser, "collectOpenCodeSessions")
      .mockImplementation(async (dirPath) => {
        if (dirPath.includes("ses_bad")) {
          throw new Error("Simulated opencode parser crash");
        }
        return origCollect(dirPath);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSessionSync({
        stateDir,
        openCodeMessageDir: msgDir,
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good dir's data should still be synced
      expect(result.sources.opencode).toBeGreaterThanOrEqual(1);

      // Verify a warning was emitted for the bad dir
      const warnEvents = events.filter(
        (e) => e.source === "opencode" && e.phase === "warn",
      );
      expect(warnEvents).toHaveLength(1);
      expect(warnEvents[0].message).toContain("Simulated opencode parser crash");
    } finally {
      spy.mockRestore();
    }
  });

  it("should emit warning and continue when OpenClaw session parser throws", async () => {
    const agentDir = join(dataDir, ".openclaw-err", "agents", "agent-err", "sessions");
    await mkdir(agentDir, { recursive: true });

    // Good file
    await writeFile(
      join(agentDir, "session-good.jsonl"),
      [
        openclawLine("2026-03-07T14:00:00.000Z", "system"),
        openclawLine("2026-03-07T14:01:00.000Z", "message"),
        openclawLine("2026-03-07T14:05:00.000Z", "message"),
      ].join("\n") + "\n",
    );

    // Bad file — will be forced to throw via spy
    await writeFile(
      join(agentDir, "session-bad.jsonl"),
      [
        openclawLine("2026-03-07T15:00:00.000Z", "system"),
        openclawLine("2026-03-07T15:01:00.000Z", "message"),
      ].join("\n") + "\n",
    );

    const ocParser = await import("../parsers/openclaw-session.js");
    const origCollect = ocParser.collectOpenClawSessions;
    const spy = vi
      .spyOn(ocParser, "collectOpenClawSessions")
      .mockImplementation(async (filePath) => {
        if (filePath.includes("session-bad")) {
          throw new Error("Simulated openclaw parser crash");
        }
        return origCollect(filePath);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSessionSync({
        stateDir,
        openclawDir: join(dataDir, ".openclaw-err"),
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good file's data should still be synced
      expect(result.sources.openclaw).toBeGreaterThanOrEqual(1);

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

  // ===== OpenCode SQLite onProgress coverage =====

  it("should emit progress for SQLite session parse with found sessions", async () => {
    const sessions = [
      { id: "ses_prog_sql", project_id: "proj_1", title: "Test", time_created: 1739600000000, time_updated: 1739600600000 },
    ];
    const messages = [
      { session_id: "ses_prog_sql", role: "user", time_created: 1739600000000, data: sqliteMsgData({ role: "user", timeCreated: 1739600000000 }) },
      { session_id: "ses_prog_sql", role: "assistant", time_created: 1739600100000, data: sqliteMsgData({ role: "assistant", timeCreated: 1739600100000 }) },
    ];

    const dbDir = join(dataDir, "opencode-sqlprog");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions, messages),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
    });

    // Verify discover event
    const discoverEvents = events.filter(
      (e) => e.source === "opencode-sqlite" && e.phase === "discover",
    );
    expect(discoverEvents).toHaveLength(1);

    // Verify parse event with session count details
    const parseEvents = events.filter(
      (e) => e.source === "opencode-sqlite" && e.phase === "parse",
    );
    expect(parseEvents).toHaveLength(1);
    expect(parseEvents[0].message).toContain("Collected 1 sessions");
  });

  it("should emit 'No new SQLite sessions found' progress when no new sessions", async () => {
    const sessions = [
      { id: "ses_empty_sql", project_id: null, title: null, time_created: 1739600000000, time_updated: 1739600600000 },
    ];
    const messages = [
      { session_id: "ses_empty_sql", role: "user", time_created: 1739600000000, data: sqliteMsgData({ role: "user", timeCreated: 1739600000000 }) },
    ];

    const dbDir = join(dataDir, "opencode-sqlempty");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "opencode.db");
    await writeFile(dbPath, "dummy");

    // First sync to establish cursor
    await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions, messages),
    });

    // Second sync with onProgress — no new sessions
    const events: Array<{ source: string; phase: string; message?: string }> = [];
    await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions, messages),
      onProgress: (e) => events.push({ source: e.source, phase: e.phase, message: e.message }),
    });

    const parseEvents = events.filter(
      (e) => e.source === "opencode-sqlite" && e.phase === "parse",
    );
    expect(parseEvents).toHaveLength(1);
    expect(parseEvents[0].message).toBe("No new SQLite sessions found");
  });

  // ===== Claude parse error with onProgress =====

  it("should emit warning and continue when Claude session parser throws", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-err");
    await mkdir(claudeDir, { recursive: true });

    // Good file
    await writeFile(
      join(claudeDir, "session-good.jsonl"),
      [
        claudeUserLine("2026-03-07T10:00:00.000Z", "ses-good"),
        claudeAssistantLine("2026-03-07T10:05:00.000Z", "ses-good"),
      ].join("\n") + "\n",
    );

    // Bad file — will be forced to throw via spy
    await writeFile(
      join(claudeDir, "session-bad.jsonl"),
      [
        claudeUserLine("2026-03-07T11:00:00.000Z", "ses-bad"),
        claudeAssistantLine("2026-03-07T11:05:00.000Z", "ses-bad"),
      ].join("\n") + "\n",
    );

    const claudeParser = await import("../parsers/claude-session.js");
    const origCollect = claudeParser.collectClaudeSessions;
    const spy = vi
      .spyOn(claudeParser, "collectClaudeSessions")
      .mockImplementation(async (filePath) => {
        if (filePath.includes("session-bad")) {
          throw new Error("Simulated claude session parser crash");
        }
        return origCollect(filePath);
      });

    const events: Array<{ source: string; phase: string; message?: string }> = [];

    try {
      const result = await executeSessionSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
        onProgress: (e) =>
          events.push({ source: e.source, phase: e.phase, message: e.message }),
      });

      // Good file should still be synced
      expect(result.sources.claude).toBeGreaterThanOrEqual(1);

      // Verify warning for the bad file
      const warnEvents = events.filter(
        (e) => e.source === "claude-code" && e.phase === "warn",
      );
      expect(warnEvents).toHaveLength(1);
      expect(warnEvents[0].message).toContain("Simulated claude session parser crash");
    } finally {
      spy.mockRestore();
    }
  });

  // ----- Crash-safety ordering invariant -----

  it("should write queue BEFORE saving cursors (crash-safety)", async () => {
    const claudeDir = join(dataDir, ".claude", "projects", "proj-hash");
    await mkdir(claudeDir, { recursive: true });
    const content = [
      claudeUserLine("2026-03-07T10:00:00.000Z"),
      claudeAssistantLine("2026-03-07T10:05:00.000Z"),
    ].join("\n") + "\n";
    await writeFile(join(claudeDir, "session.jsonl"), content);

    const callOrder: string[] = [];

    const queueSpy = vi
      .spyOn(SessionQueue.prototype, "appendBatch")
      .mockImplementation(async () => { callOrder.push("queue.appendBatch"); });

    const cursorSpy = vi
      .spyOn(SessionCursorStore.prototype, "save")
      .mockImplementation(async () => { callOrder.push("cursorStore.save"); });

    try {
      await executeSessionSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
      });

      expect(callOrder).toEqual(["queue.appendBatch", "cursorStore.save"]);
    } finally {
      queueSpy.mockRestore();
      cursorSpy.mockRestore();
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSessionSync, type SessionSyncProgressEvent } from "../commands/session-sync.js";
import { SessionCursorStore } from "../storage/session-cursor-store.js";
import { SessionQueue } from "../storage/session-queue.js";
import type { SessionQueueRecord } from "@pew/core";

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
    message: { model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } },
  });
}

function piSession(opts: {
  sessionId?: string;
  messages: Array<{ type: string; timestamp: string; model?: string }>;
}): string {
  return `${[{ type: "session", id: opts.sessionId ?? "pi-session" }, ...opts.messages.map((m) => ({ type: "message", timestamp: m.timestamp, message: { role: m.type === "user" ? "user" : "assistant", model: m.model ?? "pi-model" } }))].map((x) => JSON.stringify(x)).join("\n")}\n`;
}

function opencodeMsg(opts: {
  sessionID?: string;
  role?: string;
  created: number;
  completed?: number;
}): string {
  return JSON.stringify({
    id: `msg_${opts.created}`,
    sessionID: opts.sessionID ?? "ses_oc001",
    role: opts.role ?? "assistant",
    modelID: "claude-opus-4.6",
    time: { created: opts.created, completed: opts.completed ?? opts.created + 1000 },
    tokens: { total: 100, input: 80, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
  });
}

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
            usage: { input: 100, cacheRead: 0, cacheWrite: 0, output: 50, totalTokens: 150 },
          }
        : undefined,
  });
}

function codexLines(ts: string, sessionId = "ses-codex-001"): string {
  const base = ts.slice(0, 13);
  return `${[
    JSON.stringify({
      timestamp: `${base}:00:00.000Z`,
      type: "session_meta",
      payload: { id: sessionId, cwd: "/tmp/project", model: "gpt-5.4" },
    }),
    JSON.stringify({
      timestamp: `${base}:00:01.000Z`,
      type: "turn_context",
      payload: { model: "gpt-5.4", cwd: "/tmp/project" },
    }),
    JSON.stringify({
      timestamp: `${base}:01:00.000Z`,
      type: "response_item",
      payload: { role: "user" },
    }),
    JSON.stringify({
      timestamp: `${base}:02:00.000Z`,
      type: "response_item",
      payload: { role: "assistant" },
    }),
    JSON.stringify({
      timestamp: `${base}:02:01.000Z`,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 3000,
            cached_input_tokens: 0,
            output_tokens: 500,
            reasoning_output_tokens: 0,
            total_tokens: 3500,
          },
        },
      },
    }),
  ].join("\n")}\n`;
}

function copilotCliLog(opts: {
  sessionId: string;
  requestCount?: number;
  startTs?: string;
}): string {
  const { sessionId, requestCount = 1, startTs = "2026-03-07T10:00:00.000Z" } = opts;
  const lines = [
    `${startTs} [INFO] Session indexing debug: SESSION_INDEXING=false`,
    `${startTs} [INFO] Workspace initialized: ${sessionId} (checkpoints: 0)`,
    `${startTs} [INFO] Using default model: claude-sonnet-4.6`,
  ];
  for (let i = 0; i < requestCount; i++) {
    const ts = startTs.replace(":00.000Z", `:${String(i + 1).padStart(2, "0")}.000Z`);
    lines.push(
      `${ts} [INFO] --- Start of group: Sending request to the AI model ---`,
      `${ts} [INFO] --- End of group ---`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function sqliteMsgData(opts: { role: string; timeCreated?: number }): string {
  const created = opts.timeCreated ?? 1739600000000;
  return JSON.stringify({
    role: opts.role,
    modelID: "claude-sonnet-4-20250514",
    time: { created, completed: created + 5000 },
    tokens:
      opts.role === "assistant"
        ? { total: 150, input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } }
        : null,
  });
}

function mockOpenSessionDb(
  sessions: Array<{
    id: string;
    project_id: string | null;
    title: string | null;
    time_created: number;
    time_updated: number;
  }>,
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

async function readSessionQueue(stateDir: string): Promise<SessionQueueRecord[]> {
  try {
    const raw = await readFile(join(stateDir, "session-queue.jsonl"), "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as SessionQueueRecord);
  } catch {
    return [];
  }
}

async function writeFileEnsured(filePath: string, content: string): Promise<string> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

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

  it("handles no data directories at all", async () => {
    const result = await executeSessionSync({ stateDir });
    expect(result.totalSnapshots).toBe(0);
    expect(result.totalRecords).toBe(0);
    expect(result.filesScanned).toEqual({
      antigravity: 0,
      claude: 0,
      codex: 0,
      copilotCli: 0,
      pi: 0,
      grok: 0,
      opencode: 0,
      openclaw: 0,
    });
  });

  it("syncs all six file sources, persists cursors, emits progress, and skips unchanged files on second sync", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-hash/session.jsonl"),
      `${[claudeUserLine("2026-03-07T10:00:00.000Z"), claudeAssistantLine("2026-03-07T10:30:00.000Z")].join("\n")}\n`,
    );
    await writeFileEnsured(
      join(dataDir, ".pi/agent/sessions/proj-gem/session.jsonl"),
      piSession({
        sessionId: "gem-001",
        messages: [
          { type: "user", timestamp: "2026-03-07T11:00:00.000Z" },
          { type: "pi", timestamp: "2026-03-07T11:05:00.000Z", model: "pi-2.5-pro" },
        ],
      }),
    );
    await writeFileEnsured(
      join(dataDir, "opencode/message/ses_001/msg_001.json"),
      opencodeMsg({ sessionID: "ses_001", role: "user", created: 1741320000000 }),
    );
    await writeFileEnsured(
      join(dataDir, "opencode/message/ses_001/msg_002.json"),
      opencodeMsg({ sessionID: "ses_001", role: "assistant", created: 1741320300000 }),
    );
    await writeFileEnsured(
      join(dataDir, "opencode/message/ses_002/msg_001.json"),
      opencodeMsg({ sessionID: "ses_002", role: "user", created: 1741321000000 }),
    );
    await writeFileEnsured(
      join(dataDir, ".openclaw/agents/a1/sessions/session.jsonl"),
      `${[openclawLine("2026-03-07T12:00:00.000Z", "system"), openclawLine("2026-03-07T12:01:00.000Z", "message"), openclawLine("2026-03-07T12:05:00.000Z", "tool")].join("\n")}\n`,
    );
    await writeFileEnsured(
      join(dataDir, ".codex/sessions/2026/03/07/rollout-abc123.jsonl"),
      codexLines("2026-03-07T13:00:00.000Z"),
    );
    await writeFileEnsured(
      join(dataDir, ".copilot/logs/process-123.log"),
      copilotCliLog({
        sessionId: "11111111-2222-3333-4444-555555555555",
        requestCount: 2,
        startTs: "2026-03-07T14:00:00.000Z",
      }),
    );

    const opts = {
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      codexSessionsDir: join(dataDir, ".codex/sessions"),
      copilotCliLogsDir: join(dataDir, ".copilot/logs"),
      piSessionsDir: join(dataDir, ".pi/agent/sessions"),
      openCodeMessageDir: join(dataDir, "opencode/message"),
      openclawDir: join(dataDir, ".openclaw"),
    };

    const ev1: SessionSyncProgressEvent[] = [];
    const r1 = await executeSessionSync({ ...opts, onProgress: (e) => ev1.push(e) });
    expect(r1.sources).toMatchObject({
      claude: 1,
      codex: 1,
      copilotCli: 1,
      pi: 1,
      opencode: 2,
      openclaw: 1,
    });
    expect(r1.totalSnapshots).toBe(7);

    const records = await readSessionQueue(stateDir);
    expect(records.find((r) => r.source === "claude-code")).toMatchObject({
      kind: "human",
      user_messages: 1,
      assistant_messages: 1,
      total_messages: 2,
    });
    expect(records.find((r) => r.source === "openclaw")?.kind).toBe("automated");
    expect(records.find((r) => r.source === "codex")).toMatchObject({
      session_key: "codex:ses-codex-001",
      model: "gpt-5.4",
      project_ref: "f630ad93b344dd6b",
    });

    for (const src of ["claude-code", "codex", "copilot-cli", "pi", "opencode", "openclaw"]) {
      expect(ev1.some((e) => e.source === src && e.phase === "discover")).toBe(true);
      expect(
        ev1.some((e) => e.source === src && e.phase === "parse" && e.current !== undefined),
      ).toBe(true);
    }
    expect(ev1.some((e) => e.source === "all" && e.phase === "dedup")).toBe(true);
    expect(ev1.some((e) => e.source === "all" && e.phase === "done")).toBe(true);

    // Cursor persistence
    const cursors = JSON.parse(await readFile(join(stateDir, "session-cursors.json"), "utf-8"));
    expect(cursors.version).toBe(1);
    const firstCursor = Object.values(cursors.files)[0] as Record<string, unknown>;
    expect(typeof firstCursor.mtimeMs).toBe("number");
    expect(typeof firstCursor.size).toBe("number");

    // Second sync: all unchanged -> skipped with parse progress
    const ev2: SessionSyncProgressEvent[] = [];
    const r2 = await executeSessionSync({ ...opts, onProgress: (e) => ev2.push(e) });
    expect(r2.totalSnapshots).toBe(0);
    for (const src of ["claude-code", "codex", "copilot-cli", "pi", "opencode", "openclaw"]) {
      expect(
        ev2.some((e) => e.source === src && e.phase === "parse" && e.current !== undefined),
      ).toBe(true);
    }
  });

  it("re-scans modified files and deduplicates snapshots by session_key", async () => {
    const fileA = await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-a/session.jsonl"),
      `${[claudeUserLine("2026-03-07T10:00:00.000Z", "shared-session"), claudeAssistantLine("2026-03-07T10:05:00.000Z", "shared-session")].join("\n")}\n`,
    );
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-b/session.jsonl"),
      `${[claudeUserLine("2026-03-07T10:00:00.000Z", "shared-session"), claudeAssistantLine("2026-03-07T10:05:00.000Z", "shared-session"), claudeUserLine("2026-03-07T10:10:00.000Z", "shared-session")].join("\n")}\n`,
    );
    await executeSessionSync({ stateDir, claudeDir: join(dataDir, ".claude") });
    expect(
      (await readSessionQueue(stateDir)).filter((r) => r.session_key.includes("shared-session")),
    ).toHaveLength(1);

    const future = new Date(Date.now() + 2000);
    await writeFile(
      fileA,
      `${[claudeUserLine("2026-03-07T10:00:00.000Z", "shared-session"), claudeAssistantLine("2026-03-07T10:05:00.000Z", "shared-session"), claudeUserLine("2026-03-07T10:20:00.000Z", "shared-session")].join("\n")}\n`,
    );
    await utimes(fileA, future, future);
    const r2 = await executeSessionSync({ stateDir, claudeDir: join(dataDir, ".claude") });
    expect(r2.totalSnapshots).toBeGreaterThanOrEqual(1);
  });

  // ===== OpenCode SQLite session integration =====

  it("syncs OpenCode SQLite sessions, stays incremental, and handles JSON + SQLite + same-ms boundary", async () => {
    const sameMs = 1739600600000;
    const dbPath = await writeFileEnsured(join(dataDir, "opencode/opencode.db"), "dummy");
    await writeFileEnsured(
      join(dataDir, "opencode/message/ses_json001/msg_001.json"),
      opencodeMsg({ sessionID: "ses_json001", role: "user", created: 1741320000000 }),
    );
    await writeFileEnsured(
      join(dataDir, "opencode/message/ses_json001/msg_002.json"),
      opencodeMsg({ sessionID: "ses_json001", role: "assistant", created: 1741320300000 }),
    );

    const sessions1 = [
      {
        id: "ses_sql_001",
        project_id: "proj_1",
        title: "Test",
        time_created: 1739600000000,
        time_updated: sameMs,
      },
      {
        id: "ses_sql_002",
        project_id: null,
        title: null,
        time_created: 1739600100000,
        time_updated: sameMs,
      },
    ];
    const messages1 = [
      {
        session_id: "ses_sql_001",
        role: "user",
        time_created: 1739600000000,
        data: sqliteMsgData({ role: "user", timeCreated: 1739600000000 }),
      },
      {
        session_id: "ses_sql_001",
        role: "assistant",
        time_created: 1739600100000,
        data: sqliteMsgData({ role: "assistant", timeCreated: 1739600100000 }),
      },
      {
        session_id: "ses_sql_002",
        role: "user",
        time_created: 1739600200000,
        data: sqliteMsgData({ role: "user", timeCreated: 1739600200000 }),
      },
    ];

    const ev1: SessionSyncProgressEvent[] = [];
    const r1 = await executeSessionSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode/message"),
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions1, messages1),
      onProgress: (e) => ev1.push(e),
    });
    expect(r1.sources.opencode).toBe(3);
    expect(r1.dbsScanned.opencode).toBe(1);
    expect(
      ev1.some(
        (e) =>
          e.source === "opencode-sqlite" &&
          e.phase === "parse" &&
          e.message?.includes("Collected 2 sessions"),
      ),
    ).toBe(true);

    const recs = await readSessionQueue(stateDir);
    expect(recs.find((r) => r.session_key === "opencode:ses_sql_001")?.project_ref).toBe(
      "f8d5ee0ecbba1420",
    );

    // Second sync: unchanged SQLite sessions -> 0 snapshots + progress message
    const ev2: SessionSyncProgressEvent[] = [];
    const r2 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(sessions1, messages1),
      onProgress: (e) => ev2.push(e),
    });
    expect(r2.totalSnapshots).toBe(0);
    expect(ev2.find((e) => e.source === "opencode-sqlite" && e.phase === "parse")?.message).toBe(
      "No new OpenCode SQLite sessions found",
    );

    // Third sync: new session at exact same time_updated ms
    const r3 = await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: mockOpenSessionDb(
        [
          ...sessions1,
          {
            id: "ses_sql_003",
            project_id: null,
            title: null,
            time_created: 1739600200000,
            time_updated: sameMs,
          },
        ],
        [
          ...messages1,
          {
            session_id: "ses_sql_003",
            role: "user",
            time_created: 1739600200000,
            data: sqliteMsgData({ role: "user", timeCreated: 1739600200000 }),
          },
        ],
      ),
    });
    expect(r3.totalSnapshots).toBe(1);
  });

  it("handles missing OpenCode DB, missing openSessionDb adapter, and null openSessionDb", async () => {
    const rMissing = await executeSessionSync({
      stateDir,
      openCodeDbPath: "/nonexistent/opencode.db",
      openSessionDb: mockOpenSessionDb([], []),
    });
    expect(rMissing.sources.opencode).toBe(0);

    const dbPath = await writeFileEnsured(join(dataDir, "opencode/opencode.db"), "dummy");
    const evNoAdapter: SessionSyncProgressEvent[] = [];
    await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      onProgress: (e) => evNoAdapter.push(e),
    });
    expect(
      evNoAdapter.some(
        (e) =>
          e.source === "opencode-sqlite" &&
          e.phase === "warn" &&
          e.message?.includes("SQLite is not available"),
      ),
    ).toBe(true);

    const evNull: SessionSyncProgressEvent[] = [];
    await executeSessionSync({
      stateDir,
      openCodeDbPath: dbPath,
      openSessionDb: () => null,
      onProgress: (e) => evNull.push(e),
    });
    expect(
      evNull.some(
        (e) =>
          e.source === "opencode-sqlite" &&
          e.phase === "warn" &&
          e.message?.includes("Failed to open"),
      ),
    ).toBe(true);
  });

  // ===== Per-source parser error isolation =====

  it.each([
    {
      label: "claude-code",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".claude/projects/p/good.jsonl"),
          `${claudeUserLine("2026-03-07T10:00:00.000Z", "g")}\n`,
        ),
        bad: await writeFileEnsured(
          join(d, ".claude/projects/p/bad.jsonl"),
          `${claudeUserLine("2026-03-07T11:00:00.000Z", "b")}\n`,
        ),
        opts: { claudeDir: join(d, ".claude") },
        mod: () => import("../parsers/claude-session.js"),
        fn: "collectClaudeSessions",
        key: "claude" as const,
      }),
    },
    {
      label: "codex",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".codex/sessions/2026/03/07/rollout-good.jsonl"),
          codexLines("2026-03-07T10:00:00.000Z"),
        ),
        bad: await writeFileEnsured(
          join(d, ".codex/sessions/2026/03/07/rollout-bad.jsonl"),
          codexLines("2026-03-07T11:00:00.000Z"),
        ),
        opts: { codexSessionsDir: join(d, ".codex/sessions") },
        mod: () => import("../parsers/codex-session.js"),
        fn: "collectCodexSessions",
        key: "codex" as const,
      }),
    },
    {
      label: "pi",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".pi/agent/sessions/p/good.jsonl"),
          piSession({
            sessionId: "g",
            messages: [{ type: "user", timestamp: "2026-03-07T11:00:00.000Z" }],
          }),
        ),
        bad: await writeFileEnsured(
          join(d, ".pi/agent/sessions/p/bad.jsonl"),
          piSession({
            sessionId: "b",
            messages: [{ type: "user", timestamp: "2026-03-07T12:00:00.000Z" }],
          }),
        ),
        opts: { piSessionsDir: join(d, ".pi/agent/sessions") },
        mod: () => import("../parsers/pi-session.js"),
        fn: "collectPiSessions",
        key: "pi" as const,
      }),
    },
    {
      label: "opencode",
      setup: async (d: string) => {
        await writeFileEnsured(
          join(d, "opencode/message/ses_good/msg_001.json"),
          opencodeMsg({ sessionID: "ses_good", role: "user", created: 1741320000000 }),
        );
        await writeFileEnsured(
          join(d, "opencode/message/ses_bad/msg_001.json"),
          opencodeMsg({ sessionID: "ses_bad", role: "user", created: 1741321000000 }),
        );
        return {
          bad: "ses_bad",
          opts: { openCodeMessageDir: join(d, "opencode/message") },
          mod: () => import("../parsers/opencode-session.js"),
          fn: "collectOpenCodeSessions",
          key: "opencode" as const,
        };
      },
    },
    {
      label: "openclaw",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".openclaw/agents/a1/sessions/good.jsonl"),
          `${openclawLine("2026-03-07T14:00:00.000Z", "message")}\n`,
        ),
        bad: await writeFileEnsured(
          join(d, ".openclaw/agents/a1/sessions/bad.jsonl"),
          `${openclawLine("2026-03-07T15:00:00.000Z", "message")}\n`,
        ),
        opts: { openclawDir: join(d, ".openclaw") },
        mod: () => import("../parsers/openclaw-session.js"),
        fn: "collectOpenClawSessions",
        key: "openclaw" as const,
      }),
    },
  ])("emits warning and continues when $label session parser throws", async ({ label, setup }) => {
    const cfg = await setup(dataDir);
    const mod = (await cfg.mod()) as Record<string, (p: string) => Promise<unknown>>;
    const orig = mod[cfg.fn];
    const spy = vi.spyOn(mod, cfg.fn).mockImplementation(async (p: string) => {
      if (p.includes(cfg.bad)) throw new Error(`Simulated ${label} session crash`);
      return orig(p);
    });
    const events: SessionSyncProgressEvent[] = [];
    try {
      const result = await executeSessionSync({
        stateDir,
        ...cfg.opts,
        onProgress: (e) => events.push(e),
      });
      expect(result.sources[cfg.key]).toBeGreaterThanOrEqual(1);
      const warns = events.filter((e) => e.source === label && e.phase === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.message).toContain(`Simulated ${label} session crash`);
    } finally {
      spy.mockRestore();
    }
  });

  // ===== Crash safety & symlink alias pruning =====

  it("writes queue BEFORE saving cursors (crash-safety)", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-hash/session.jsonl"),
      `${[claudeUserLine("2026-03-07T10:00:00.000Z"), claudeAssistantLine("2026-03-07T10:05:00.000Z")].join("\n")}\n`,
    );
    const callOrder: string[] = [];
    const qSpy = vi.spyOn(SessionQueue.prototype, "appendBatch").mockImplementation(async () => {
      callOrder.push("queue.appendBatch");
    });
    const cSpy = vi.spyOn(SessionCursorStore.prototype, "save").mockImplementation(async () => {
      callOrder.push("cursorStore.save");
    });
    try {
      await executeSessionSync({ stateDir, claudeDir: join(dataDir, ".claude") });
      expect(callOrder).toEqual(["queue.appendBatch", "cursorStore.save"]);
    } finally {
      qSpy.mockRestore();
      cSpy.mockRestore();
    }
  });

  it("prunes cursor entries that are symlink aliases of a discovered file", async () => {
    const claudeDir = join(dataDir, ".claude");
    const realPath = await writeFileEnsured(
      join(claudeDir, "projects/proj-real/session.jsonl"),
      `${[claudeUserLine("2026-03-07T10:00:00.000Z"), claudeAssistantLine("2026-03-07T10:05:00.000Z")].join("\n")}\n`,
    );
    const aliasPath = join(dataDir, "elsewhere/session.jsonl");
    await mkdir(join(dataDir, "elsewhere"), { recursive: true });
    await symlink(realPath, aliasPath);

    await executeSessionSync({ stateDir, claudeDir });
    const cursorsPath = join(stateDir, "session-cursors.json");
    const c = JSON.parse(await readFile(cursorsPath, "utf-8"));
    c.files[aliasPath] = { ...c.files[realPath] };
    await writeFile(cursorsPath, JSON.stringify(c));

    await executeSessionSync({ stateDir, claudeDir });
    const after = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(after.files[realPath]).toBeDefined();
    expect(after.files[aliasPath]).toBeUndefined();
  });
});

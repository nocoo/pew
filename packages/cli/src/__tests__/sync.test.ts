import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSync, type SyncProgressEvent } from "../commands/sync.js";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import type { QueueRecord } from "@pew/core";

function claudeLine(ts: string, input: number, output: number, id?: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      ...(id ? { id } : {}),
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

function piSession(ts: string, input: number, output: number): string {
  return `${JSON.stringify({ type: "message", timestamp: ts, message: { role: "assistant", model: "pi-model", usage: { input, output, cacheRead: 0, cacheWrite: 0 } } })}\n`;
}

function opencodeMsg(ts: number, input: number, output: number): string {
  return JSON.stringify({
    id: "msg_001",
    sessionID: "ses_001",
    role: "assistant",
    modelID: "claude-opus-4.6",
    time: { created: ts, completed: ts + 1000 },
    tokens: { total: input + output, input, output, reasoning: 0, cache: { read: 0, write: 0 } },
  });
}

function openclawLine(ts: string, input: number, output: number): string {
  return JSON.stringify({
    type: "message",
    timestamp: ts,
    message: {
      model: "claude-sonnet-4",
      usage: { input, cacheRead: 0, cacheWrite: 0, output, totalTokens: input + output },
    },
  });
}

function codexLines(ts: string, input: number, output: number): string {
  return [
    JSON.stringify({
      timestamp: ts,
      type: "session_meta",
      payload: { id: "ses-codex-001", cwd: "/tmp/project", model: "gpt-5.4" },
    }),
    JSON.stringify({
      timestamp: ts,
      type: "turn_context",
      payload: { model: "gpt-5.4", cwd: "/tmp/project" },
    }),
    JSON.stringify({
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
    }),
  ].join("\n");
}

function sqliteRowData(opts: {
  role: string;
  input?: number;
  output?: number;
  timeCreated?: number;
}): string {
  const created = opts.timeCreated ?? 1739600000000;
  return JSON.stringify({
    role: opts.role,
    modelID: "claude-sonnet-4-20250514",
    time: { created, completed: created + 5000 },
    tokens:
      opts.role === "assistant"
        ? {
            total: (opts.input ?? 100) + (opts.output ?? 50),
            input: opts.input ?? 100,
            output: opts.output ?? 50,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          }
        : null,
  });
}

function mockOpenMessageDb(
  rows: Array<{
    id: string;
    session_id: string;
    time_created: number;
    role?: string | null;
    data: string;
  }>,
) {
  const enriched = rows.map((r) => ({
    ...r,
    role:
      r.role !== undefined
        ? r.role
        : (((JSON.parse(r.data) as Record<string, unknown>).role as string) ?? null),
  }));
  return (_dbPath: string) => ({
    queryMessages: (lastTimeCreated: number) =>
      enriched.filter((r) => r.time_created >= lastTimeCreated),
    close: () => {},
  });
}

function mockOpenHermesDb(
  rows: Array<{
    id: string;
    model: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    reasoning_tokens: number;
    started_at: number;
  }>,
) {
  return (_dbPath: string) => ({ querySessions: () => rows, close: () => {} });
}

function hermesRow(
  id: string,
  input: number,
  output: number,
  extra: { cacheRead?: number; cacheWrite?: number } = {},
) {
  return {
    id,
    model: "claude-sonnet-4",
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: extra.cacheRead ?? 0,
    cache_write_tokens: extra.cacheWrite ?? 0,
    reasoning_tokens: 0,
    started_at: 1775210400,
  };
}

async function readQueue(stateDir: string): Promise<QueueRecord[]> {
  const raw = await readFile(join(stateDir, "queue.jsonl"), "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as QueueRecord);
}

async function writeFileEnsured(filePath: string, content: string): Promise<string> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
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

  it("handles no data directories at all", async () => {
    const result = await executeSync({ stateDir });
    expect(result.totalDeltas).toBe(0);
    expect(result.totalRecords).toBe(0);
  });

  it("syncs all five file sources simultaneously and fires progress events for all phases", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-a/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
    );
    await writeFileEnsured(
      join(dataDir, ".pi/agent/sessions/proj-b/session.jsonl"),
      piSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );
    await writeFileEnsured(
      join(dataDir, "opencode/message/ses_001/msg_001.json"),
      opencodeMsg(1771120749059, 14967, 437),
    );
    await writeFileEnsured(
      join(dataDir, ".openclaw/agents/a1/sessions/session.jsonl"),
      `${openclawLine("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
    );
    await writeFileEnsured(
      join(dataDir, ".codex/sessions/2026/03/07/rollout-abc123.jsonl"),
      `${codexLines("2026-03-07T10:15:00.000Z", 3000, 500)}\n`,
    );

    const events: SyncProgressEvent[] = [];
    const result = await executeSync({
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      piSessionsDir: join(dataDir, ".pi/agent/sessions"),
      openCodeMessageDir: join(dataDir, "opencode/message"),
      openclawDir: join(dataDir, ".openclaw"),
      codexSessionsDir: join(dataDir, ".codex/sessions"),
      onProgress: (e) => events.push(e),
    });

    expect(result.totalDeltas).toBe(5);
    expect(result.sources).toMatchObject({ claude: 1, pi: 1, opencode: 1, openclaw: 1, codex: 1 });
    expect(result.filesScanned).toMatchObject({
      claude: 1,
      pi: 1,
      opencode: 1,
      openclaw: 1,
      codex: 1,
    });

    const records = await readQueue(stateDir);
    expect(records.find((r) => r.source === "claude-code")).toMatchObject({
      model: "glm-5",
      input_tokens: 5000,
      output_tokens: 800,
      hour_start: "2026-03-07T10:00:00.000Z",
    });
    expect(records.find((r) => r.source === "codex")).toMatchObject({
      model: "gpt-5.4",
      input_tokens: 3000,
      output_tokens: 500,
    });

    for (const src of ["claude-code", "pi", "opencode", "openclaw", "codex"]) {
      expect(events.some((e) => e.source === src && e.phase === "discover")).toBe(true);
      expect(events.some((e) => e.source === src && e.phase === "parse")).toBe(true);
    }
    expect(events.some((e) => e.source === "all" && e.phase === "aggregate")).toBe(true);
    expect(events.some((e) => e.source === "all" && e.phase === "done")).toBe(true);
  });

  it("aggregates multiple deltas into one bucket record and accumulates incremental syncs", async () => {
    const filePath = await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-a/session.jsonl"),
      `${[claudeLine("2026-03-07T10:05:00.000Z", 1000, 100), claudeLine("2026-03-07T10:20:00.000Z", 2000, 200)].join("\n")}\n`,
    );

    const r1 = await executeSync({ stateDir, claudeDir: join(dataDir, ".claude") });
    expect(r1.totalDeltas).toBe(2);
    expect(r1.totalRecords).toBe(1);

    await appendFile(filePath, `${claudeLine("2026-03-07T10:25:00.000Z", 500, 50)}\n`);
    await executeSync({ stateDir, claudeDir: join(dataDir, ".claude") });

    const records = await readQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ input_tokens: 3500, output_tokens: 350 });
  });

  it("is incremental on second sync and handles appended Codex & OpenClaw lines", async () => {
    const codexPath = await writeFileEnsured(
      join(dataDir, ".codex/sessions/2026/03/07/rollout-abc123.jsonl"),
      `${codexLines("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
    );
    const clawPath = await writeFileEnsured(
      join(dataDir, ".openclaw/agents/a1/sessions/session.jsonl"),
      `${openclawLine("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
    );

    const opts = {
      stateDir,
      codexSessionsDir: join(dataDir, ".codex/sessions"),
      openclawDir: join(dataDir, ".openclaw"),
    };
    expect((await executeSync(opts)).totalDeltas).toBe(2);
    expect((await executeSync(opts)).totalDeltas).toBe(0);

    await appendFile(
      codexPath,
      `${JSON.stringify({
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
      })}\n`,
    );
    await appendFile(clawPath, `${openclawLine("2026-03-07T11:15:00.000Z", 3000, 400)}\n`);

    const r3 = await executeSync(opts);
    expect(r3.sources).toMatchObject({ codex: 1, openclaw: 1 });
    const codexRecs = (await readQueue(stateDir)).filter((r) => r.source === "codex");
    expect(codexRecs[1]).toMatchObject({ input_tokens: 3000, output_tokens: 400 });
  });

  it("handles OpenCode dir-level mtime skip, file-level skip, and new file detection with progress", async () => {
    const ocDir = join(dataDir, "opencode/message/ses_001");
    await writeFileEnsured(join(ocDir, "msg_001.json"), opencodeMsg(1771120749059, 100, 50));
    const msgDir = join(dataDir, "opencode/message");

    await executeSync({ stateDir, openCodeMessageDir: msgDir });

    const skipEvents: SyncProgressEvent[] = [];
    const rSkip = await executeSync({
      stateDir,
      openCodeMessageDir: msgDir,
      onProgress: (e) => skipEvents.push(e),
    });
    expect(rSkip.totalDeltas).toBe(0);
    const dirSkipEvt = skipEvents.find(
      (e) => e.source === "opencode" && e.phase === "parse" && e.total !== undefined,
    );
    expect(dirSkipEvt?.total).toBe(0);
    expect(dirSkipEvt?.message).toContain("1 dirs skipped");

    const future = new Date(Date.now() + 2000);
    await writeFile(join(ocDir, "msg_002.json"), opencodeMsg(1771120799059, 200, 100));
    await utimes(ocDir, future, future);

    const fileEvents: SyncProgressEvent[] = [];
    const rNew = await executeSync({
      stateDir,
      openCodeMessageDir: msgDir,
      onProgress: (e) => fileEvents.push(e),
    });
    expect(rNew.sources.opencode).toBe(1);
    expect(
      fileEvents.filter(
        (e) => e.source === "opencode" && e.phase === "parse" && e.current !== undefined,
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("continues syncing other sources when one source's parser throws", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-a/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
    );
    await writeFileEnsured(
      join(dataDir, ".openclaw/agents/a1/sessions/session.jsonl"),
      `${openclawLine("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
    );

    const claudeParser = await import("../parsers/claude.js");
    const spy = vi
      .spyOn(claudeParser, "parseClaudeFile")
      .mockRejectedValue(new Error("Claude crash"));
    try {
      const result = await executeSync({
        stateDir,
        claudeDir: join(dataDir, ".claude"),
        openclawDir: join(dataDir, ".openclaw"),
      });
      expect(result.sources.openclaw).toBe(1);
      expect((await readQueue(stateDir)).some((r) => r.source === "openclaw")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    {
      label: "claude-code",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".claude/projects/proj-good/session.jsonl"),
          `${claudeLine("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
        ),
        bad: await writeFileEnsured(
          join(d, ".claude/projects/proj-bad/bad.jsonl"),
          `${claudeLine("2026-03-07T10:15:00.000Z", 2000, 200)}\n`,
        ),
        opts: { claudeDir: join(d, ".claude") },
        mod: () => import("../parsers/claude.js"),
        fn: "parseClaudeFile" as const,
        key: "claude" as const,
      }),
    },
    {
      label: "openclaw",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".openclaw/agents/a1/sessions/good.jsonl"),
          `${openclawLine("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
        ),
        bad: await writeFileEnsured(
          join(d, ".openclaw/agents/a2/sessions/bad.jsonl"),
          `${openclawLine("2026-03-07T10:15:00.000Z", 3000, 400)}\n`,
        ),
        opts: { openclawDir: join(d, ".openclaw") },
        mod: () => import("../parsers/openclaw.js"),
        fn: "parseOpenClawFile" as const,
        key: "openclaw" as const,
      }),
    },
    {
      label: "codex",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".codex/sessions/2026/03/07/rollout-good.jsonl"),
          `${codexLines("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
        ),
        bad: await writeFileEnsured(
          join(d, ".codex/sessions/2026/03/07/rollout-bad.jsonl"),
          `${codexLines("2026-03-07T10:16:00.000Z", 3000, 400)}\n`,
        ),
        opts: { codexSessionsDir: join(d, ".codex/sessions") },
        mod: () => import("../parsers/codex.js"),
        fn: "parseCodexFile" as const,
        key: "codex" as const,
      }),
    },
    {
      label: "pi",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, ".pi/agent/sessions/p/good.jsonl"),
          piSession("2026-03-07T11:00:00.000Z", 2000, 200),
        ),
        bad: await writeFileEnsured(
          join(d, ".pi/agent/sessions/p/bad.jsonl"),
          piSession("2026-03-07T12:00:00.000Z", 3000, 300),
        ),
        opts: { piSessionsDir: join(d, ".pi/agent/sessions") },
        mod: () => import("../parsers/pi.js"),
        fn: "parsePiFile" as const,
        key: "pi" as const,
      }),
    },
    {
      label: "opencode",
      setup: async (d: string) => ({
        good: await writeFileEnsured(
          join(d, "opencode-err/message/ses_good/msg_001.json"),
          opencodeMsg(1741320000000, 100, 50),
        ),
        bad: await writeFileEnsured(
          join(d, "opencode-err/message/ses_bad/msg_001.json"),
          opencodeMsg(1741321000000, 200, 100),
        ),
        opts: { openCodeMessageDir: join(d, "opencode-err/message") },
        mod: () => import("../parsers/opencode.js"),
        fn: "parseOpenCodeFile" as const,
        key: "opencode" as const,
      }),
    },
  ])(
    "emits warning and continues syncing good files when $label parser throws",
    async ({ label, setup }) => {
      const cfg = await setup(dataDir);
      const mod = (await cfg.mod()) as Record<
        string,
        (opts: { filePath: string }) => Promise<unknown>
      >;
      const orig = mod[cfg.fn];
      const spy = vi.spyOn(mod, cfg.fn).mockImplementation(async (opts: { filePath: string }) => {
        if (opts.filePath === cfg.bad) throw new Error(`Simulated ${label} crash`);
        return orig(opts);
      });
      const events: SyncProgressEvent[] = [];
      try {
        const result = await executeSync({
          stateDir,
          ...cfg.opts,
          onProgress: (e) => events.push(e),
        });
        expect(result.sources[cfg.key]).toBe(1);
        const warns = events.filter((e) => e.source === label && e.phase === "warn");
        expect(warns).toHaveLength(1);
        expect(warns[0]?.message).toContain(`Simulated ${label} crash`);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("saves cursors AFTER queue overwrite and recovers cleanly on next sync", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-a/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
    );
    const spy = vi
      .spyOn(LocalQueue.prototype, "overwrite")
      .mockRejectedValue(new Error("Simulated queue write crash"));
    try {
      await executeSync({ stateDir, claudeDir: join(dataDir, ".claude") }).catch(() => {});
    } finally {
      spy.mockRestore();
    }

    const cursors = await new CursorStore(stateDir).load();
    expect(Object.keys(cursors.files)).toHaveLength(0);

    const recovered = await executeSync({ stateDir, claudeDir: join(dataDir, ".claude") });
    expect(recovered.totalDeltas).toBe(0);
    expect((await readQueue(stateDir))[0]?.total_tokens).toBe(1100);
  });

  it("does not inflate queue on cursor reset (full-scan overwrite)", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-inflate/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 5000, 800)}\n`,
    );
    await executeSync({ stateDir, claudeDir: join(dataDir, ".claude") });
    await rm(join(stateDir, "cursors.json"), { force: true });
    await executeSync({ stateDir, claudeDir: join(dataDir, ".claude") });

    const records = await readQueue(stateDir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ input_tokens: 5000, output_tokens: 800 });
  });

  it.skipIf(!!process.env.CI)(
    "does not inflate and emits progress when a file inode changes across multiple sources",
    async () => {
      const claudeContent = `${claudeLine("2026-03-07T10:15:00.000Z", 3000, 300)}\n`;
      const claudePath = await writeFileEnsured(
        join(dataDir, ".claude/projects/proj-multi/session.jsonl"),
        claudeContent,
      );
      await writeFileEnsured(
        join(dataDir, ".pi/agent/sessions/proj-multi/session.jsonl"),
        piSession("2026-03-07T10:15:00.000Z", 2000, 200),
      );

      const opts = {
        stateDir,
        deviceId: "dev-1",
        claudeDir: join(dataDir, ".claude"),
        piSessionsDir: join(dataDir, ".pi/agent/sessions"),
      };
      await executeSync(opts);
      const inodeBefore = (await stat(claudePath)).ino;

      await rm(claudePath);
      await new Promise((r) => setTimeout(r, 20));
      await writeFile(claudePath, claudeContent);

      const events: SyncProgressEvent[] = [];
      await executeSync({ ...opts, onProgress: (e) => events.push(e) });

      const records = await readQueue(stateDir);
      expect(records.find((r) => r.source === "claude-code")?.input_tokens).toBe(3000);
      expect(records.find((r) => r.source === "pi")?.input_tokens).toBe(2000);
      if ((await stat(claudePath)).ino !== inodeBefore) {
        expect(
          events.some((e) => e.phase === "warn" && e.message?.includes("File inode changed")),
        ).toBe(true);
      }
    },
  );

  it("detects single missing file cursor, emits replay warnings, and avoids inflation", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-loss/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
    );
    await writeFileEnsured(
      join(dataDir, ".pi/agent/sessions/proj-loss/session.jsonl"),
      piSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );
    const opts = {
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      piSessionsDir: join(dataDir, ".pi/agent/sessions"),
    };
    await executeSync(opts);

    const cursorsPath = join(stateDir, "cursors.json");
    const cursorsData = JSON.parse(await readFile(cursorsPath, "utf-8"));
    cursorsData.files = Object.fromEntries(
      Object.entries(cursorsData.files).filter(([k]) => !k.includes(".claude")),
    );
    await writeFile(cursorsPath, JSON.stringify(cursorsData));

    const events: SyncProgressEvent[] = [];
    const r2 = await executeSync({ ...opts, onProgress: (e) => events.push(e) });
    expect(r2.totalDeltas).toBe(2);
    expect(events.some((e) => e.phase === "warn" && e.message?.includes("Cursor entry lost"))).toBe(
      true,
    );
    expect(
      events.some((e) => e.phase === "warn" && e.message?.includes("Replay condition detected")),
    ).toBe(true);
    const records = await readQueue(stateDir);
    expect(records.find((r) => r.source === "claude-code")?.input_tokens).toBe(1000);
    expect(records.find((r) => r.source === "pi")?.input_tokens).toBe(2000);
  });

  it("triggers one-time full rescan when knownFilePaths or accountingSchemaVersion is missing", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-up/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 3000, 300)}\n`,
    );
    await executeSync({ stateDir, deviceId: "dev-1", claudeDir: join(dataDir, ".claude") });
    const cursorsPath = join(stateDir, "cursors.json");

    // Case 1: missing knownFilePaths
    const c1 = JSON.parse(await readFile(cursorsPath, "utf-8"));
    delete c1.knownFilePaths;
    await writeFile(cursorsPath, JSON.stringify(c1));
    const ev1: SyncProgressEvent[] = [];
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      onProgress: (e) => ev1.push(e),
    });
    expect(ev1.some((e) => e.phase === "warn" && e.message?.includes("one-time full rescan"))).toBe(
      true,
    );
    const c1After = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(Object.keys(c1After.knownFilePaths).length).toBeGreaterThan(0);

    // Case 2: missing accountingSchemaVersion
    delete c1After.accountingSchemaVersion;
    await writeFile(cursorsPath, JSON.stringify(c1After));
    const ev2: SyncProgressEvent[] = [];
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      onProgress: (e) => ev2.push(e),
    });
    expect(
      ev2.some((e) => e.phase === "warn" && e.message?.includes("Token accounting schema")),
    ).toBe(true);
    expect((await readQueue(stateDir))[0]?.input_tokens).toBe(3000);
    expect(JSON.parse(await readFile(cursorsPath, "utf-8")).accountingSchemaVersion).toBe(2);
  });

  it("tombstones removed codex buckets on accounting rescan, never non-codex", async () => {
    const claudePath = await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-keep/session.jsonl"),
      `${claudeLine("2026-03-07T11:15:00.000Z", 4000, 400)}\n`,
    );
    const codexSessionsDir = join(dataDir, ".codex/sessions");
    const gonePath = await writeFileEnsured(
      join(codexSessionsDir, "2026/03/07/rollout-gone.jsonl"),
      `${codexLines("2026-03-07T11:15:00.000Z", 4000, 400)}\n`,
    );

    const opts = {
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      codexSessionsDir,
    };
    await executeSync(opts);

    const cursorsPath = join(stateDir, "cursors.json");
    const c = JSON.parse(await readFile(cursorsPath, "utf-8"));
    delete c.accountingSchemaVersion;
    await writeFile(cursorsPath, JSON.stringify(c));
    await rm(claudePath);
    await rm(gonePath);
    await writeFileEnsured(
      join(codexSessionsDir, "2026/03/07/rollout-survivor.jsonl"),
      `${codexLines("2026-03-07T12:15:00.000Z", 100, 10)}\n`,
    );

    await executeSync(opts);
    const records = await readQueue(stateDir);
    expect(
      records.find((r) => r.source === "codex" && r.hour_start.startsWith("2026-03-07T11")),
    ).toMatchObject({ total_tokens: 0 });
    expect(records.some((r) => r.source === "claude-code")).toBe(false);
  });

  it("never tombstones codex when dir is missing, rollout parse fails, or dir is unreadable", async () => {
    const codexSessionsDir = join(dataDir, ".codex/sessions");
    const keptPath = await writeFileEnsured(
      join(codexSessionsDir, "2026/03/07/rollout-a.jsonl"),
      `${codexLines("2026-03-07T11:15:00.000Z", 4000, 400)}\n`,
    );
    const blockedDir = join(codexSessionsDir, "2026/03/08");
    await writeFileEnsured(
      join(blockedDir, "rollout-b.jsonl"),
      `${codexLines("2026-03-08T11:15:00.000Z", 100, 10)}\n`,
    );
    await executeSync({ stateDir, deviceId: "dev-1", codexSessionsDir });

    const dropSchemaVersion = async () => {
      const p = join(stateDir, "cursors.json");
      const d = JSON.parse(await readFile(p, "utf-8"));
      delete d.accountingSchemaVersion;
      await writeFile(p, JSON.stringify(d));
    };

    // 1) Unreadable day directory
    await dropSchemaVersion();
    await chmod(blockedDir, 0o000);
    try {
      await executeSync({ stateDir, deviceId: "dev-1", codexSessionsDir });
    } finally {
      await chmod(blockedDir, 0o755);
    }
    expect((await readQueue(stateDir)).some((r) => r.total_tokens === 0)).toBe(false);

    // 2) Rollout parse error
    await dropSchemaVersion();
    await rm(keptPath);
    const codexParser = await import("../parsers/codex.js");
    const spy = vi.spyOn(codexParser, "parseCodexFile").mockRejectedValue(new Error("unreadable"));
    try {
      await executeSync({ stateDir, deviceId: "dev-1", codexSessionsDir });
    } finally {
      spy.mockRestore();
    }
    expect((await readQueue(stateDir)).some((r) => r.total_tokens === 0)).toBe(false);

    // 3) Whole sessions dir missing
    await dropSchemaVersion();
    await rm(codexSessionsDir, { recursive: true });
    await executeSync({ stateDir, deviceId: "dev-1", codexSessionsDir });
    expect((await readQueue(stateDir)).some((r) => r.total_tokens === 0)).toBe(false);
  });

  it("allows genuinely new files without triggering rescan", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-new/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
    );
    await executeSync({ stateDir, deviceId: "dev-1", claudeDir: join(dataDir, ".claude") });

    await writeFileEnsured(
      join(dataDir, ".pi/agent/sessions/proj-new/session.jsonl"),
      piSession("2026-03-07T10:15:00.000Z", 2000, 200),
    );
    const r2 = await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      piSessionsDir: join(dataDir, ".pi/agent/sessions"),
    });

    expect(r2.totalDeltas).toBe(1);
    expect(r2.sources).toMatchObject({ pi: 1, claude: 0 });
    const records = await readQueue(stateDir);
    expect(records.find((r) => r.source === "claude-code")?.input_tokens).toBe(1000);
    expect(records.find((r) => r.source === "pi")?.input_tokens).toBe(2000);
  });

  it("sets queue offset to 0 on sync, preserves offset on no-op sync, and tracks dirtyKeys", async () => {
    const filePath = await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-dk/session.jsonl"),
      `${[claudeLine("2026-03-07T10:15:00.000Z", 1000, 100), claudeLine("2026-03-07T11:15:00.000Z", 2000, 200)].join("\n")}\n`,
    );
    const opts = { stateDir, deviceId: "dev-dk", claudeDir: join(dataDir, ".claude") };
    await executeSync(opts);

    const queue = new LocalQueue(stateDir);
    expect(await queue.loadOffset()).toBe(0);
    expect((await queue.loadDirtyKeys())?.sort()).toEqual([
      "claude-code|glm-5|2026-03-07T10:00:00.000Z|dev-dk",
      "claude-code|glm-5|2026-03-07T11:00:00.000Z|dev-dk",
    ]);

    // Simulate upload: advance offset and clear dirtyKeys
    const { newOffset } = await queue.readFromOffset(0);
    await queue.saveOffset(newOffset);
    await queue.saveDirtyKeys([]);

    // No-op sync: preserves offset and empty dirtyKeys
    const rNoop = await executeSync(opts);
    expect(rNoop.totalRecords).toBe(0);
    expect(await queue.loadOffset()).toBe(newOffset);
    expect(await queue.loadDirtyKeys()).toEqual([]);

    // Incremental data in same bucket (10:00) + new bucket (12:00) without clearing dirtyKeys
    await appendFile(filePath, `${claudeLine("2026-03-07T10:25:00.000Z", 500, 50)}\n`);
    await executeSync(opts);
    expect(await queue.loadDirtyKeys()).toEqual([
      "claude-code|glm-5|2026-03-07T10:00:00.000Z|dev-dk",
    ]);

    await appendFile(filePath, `${claudeLine("2026-03-07T12:15:00.000Z", 3000, 300)}\n`);
    await executeSync(opts);
    expect((await queue.loadDirtyKeys())?.sort()).toEqual([
      "claude-code|glm-5|2026-03-07T10:00:00.000Z|dev-dk",
      "claude-code|glm-5|2026-03-07T12:00:00.000Z|dev-dk",
    ]);
  });

  // ===== OpenCode SQLite =====

  it("syncs OpenCode SQLite data, stays incremental, and emits progress", async () => {
    const dbPath = await writeFileEnsured(join(dataDir, "opencode/opencode.db"), "dummy");
    const rows = [
      {
        id: "msg_001",
        session_id: "ses_001",
        time_created: 1739600000000,
        data: sqliteRowData({
          role: "assistant",
          input: 5000,
          output: 800,
          timeCreated: 1739600000000,
        }),
      },
      {
        id: "msg_002",
        session_id: "ses_001",
        time_created: 1739600010000,
        data: sqliteRowData({ role: "user", timeCreated: 1739600010000 }),
      },
    ];
    const events: SyncProgressEvent[] = [];
    const r1 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
      onProgress: (e) => events.push(e),
    });
    expect(r1.sources.opencode).toBe(1);
    expect(events.some((e) => e.source === "opencode" && e.phase === "discover")).toBe(true);
    expect(
      events.some(
        (e) => e.source === "opencode" && e.phase === "parse" && e.message?.includes("Parsed"),
      ),
    ).toBe(true);

    const r2 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
    });
    expect(r2.totalDeltas).toBe(0);
  });

  it("dedups OpenCode SQLite rows against JSON messageKeys and handles same-ms boundary", async () => {
    const ts = 1739600000000;
    await writeFileEnsured(
      join(dataDir, "opencode/message/ses_001/msg_001.json"),
      opencodeMsg(ts, 14967, 437),
    );
    await executeSync({ stateDir, openCodeMessageDir: join(dataDir, "opencode/message") });

    const dbPath = await writeFileEnsured(join(dataDir, "opencode/opencode.db"), "dummy");
    const batch1 = [
      {
        id: "msg_001",
        session_id: "ses_001",
        time_created: ts,
        data: sqliteRowData({ role: "assistant", input: 14967, output: 437, timeCreated: ts }),
      },
      {
        id: "msg_A",
        session_id: "ses_001",
        time_created: ts,
        data: sqliteRowData({ role: "assistant", input: 100, output: 50, timeCreated: ts }),
      },
    ];
    const r2 = await executeSync({
      stateDir,
      openCodeMessageDir: join(dataDir, "opencode/message"),
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(batch1),
    });
    expect(r2.sources.opencode).toBe(1); // msg_001 deduped, msg_A new

    // Same-ms repeat is deduped, new msg_B at exact same ms is processed
    const r3 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(batch1),
    });
    expect(r3.totalDeltas).toBe(0);

    const batch2 = [
      ...batch1,
      {
        id: "msg_B",
        session_id: "ses_001",
        time_created: ts,
        data: sqliteRowData({ role: "assistant", input: 200, output: 100, timeCreated: ts }),
      },
    ];
    const r4 = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(batch2),
    });
    expect(r4.totalDeltas).toBe(1);
  });

  it("handles missing OpenCode DB, empty query, missing adapter, and null openMessageDb", async () => {
    const rMissing = await executeSync({
      stateDir,
      openCodeDbPath: "/nonexistent/opencode.db",
      openMessageDb: mockOpenMessageDb([]),
    });
    expect(rMissing.sources.opencode).toBe(0);

    const dbPath = await writeFileEnsured(join(dataDir, "opencode/opencode.db"), "dummy");
    const rEmpty = await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb([]),
    });
    expect(rEmpty.sources.opencode).toBe(0);

    const evNoAdapter: SyncProgressEvent[] = [];
    await executeSync({ stateDir, openCodeDbPath: dbPath, onProgress: (e) => evNoAdapter.push(e) });
    expect(
      evNoAdapter.some(
        (e) =>
          e.source === "opencode-sqlite" &&
          e.phase === "warn" &&
          e.message?.includes("SQLite is not available"),
      ),
    ).toBe(true);

    const evNull: SyncProgressEvent[] = [];
    await executeSync({
      stateDir,
      openCodeDbPath: dbPath,
      openMessageDb: () => null,
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

  it("handles openCodeSqlite cursor loss, knownDbSources backfill, and missing knownDbSources upgrade paths", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-db/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
    );
    const dbPath = await writeFileEnsured(join(dataDir, "opencode/opencode.db"), "dummy");
    const rows = [
      {
        id: "msg_001",
        session_id: "ses_001",
        time_created: 1739600000000,
        data: sqliteRowData({ role: "assistant", input: 500, output: 200 }),
      },
    ];
    const opts = {
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
      openCodeDbPath: dbPath,
      openMessageDb: mockOpenMessageDb(rows),
    };
    const cursorsPath = join(stateDir, "cursors.json");

    await executeSync(opts);

    // 1) Cursor lost while knownDbSources present
    const c1 = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(c1.knownDbSources.openCodeSqlite).toBe(true);
    delete c1.openCodeSqlite;
    await writeFile(cursorsPath, JSON.stringify(c1));
    await executeSync(opts);
    expect((await readQueue(stateDir)).find((r) => r.source === "opencode")?.input_tokens).toBe(
      500,
    );

    // 2) Upgrade backfill when knownDbSources missing but openCodeSqlite exists
    const c2 = JSON.parse(await readFile(cursorsPath, "utf-8"));
    delete c2.knownDbSources;
    await writeFile(cursorsPath, JSON.stringify(c2));
    await executeSync(opts);
    expect(JSON.parse(await readFile(cursorsPath, "utf-8")).knownDbSources.openCodeSqlite).toBe(
      true,
    );
    expect((await readQueue(stateDir)).find((r) => r.source === "opencode")?.input_tokens).toBe(
      500,
    );

    // 3) Upgrade edge case: knownDbSources missing AND openCodeSqlite already lost -> full rescan
    const c3 = JSON.parse(await readFile(cursorsPath, "utf-8"));
    delete c3.knownDbSources;
    delete c3.openCodeSqlite;
    await writeFile(cursorsPath, JSON.stringify(c3));
    const msgs: string[] = [];
    await executeSync({ ...opts, onProgress: (e) => msgs.push(e.message) });
    expect(msgs.some((m) => m.includes("full rescan"))).toBe(true);
    expect((await readQueue(stateDir)).find((r) => r.source === "opencode")?.input_tokens).toBe(
      500,
    );
  });

  // ===== Hermes SQLite =====

  it("syncs Hermes default & profile DBs, stays incremental, and emits display name", async () => {
    const dbPath = await writeFileEnsured(join(dataDir, "hermes/state.db"), "dummy");
    const profileDb = await writeFileEnsured(
      join(dataDir, "hermes/profiles/tomato/state.db"),
      "dummy",
    );
    const events: SyncProgressEvent[] = [];

    const r1 = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      hermesProfileDbPaths: [{ dbPath: profileDb, dbKey: "profiles/tomato" }],
      openHermesDb: mockOpenHermesDb([
        hermesRow("ses-h1", 5000, 800, { cacheRead: 100, cacheWrite: 50 }),
      ]),
      onProgress: (e) => events.push(e),
    });
    expect(r1.sources.hermes).toBe(2);
    expect(events.some((e) => e.message?.includes("Hermes SQLite"))).toBe(true);

    const r2 = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      hermesProfileDbPaths: [{ dbPath: profileDb, dbKey: "profiles/tomato" }],
      openHermesDb: mockOpenHermesDb([
        hermesRow("ses-h1", 5000, 800, { cacheRead: 100, cacheWrite: 50 }),
      ]),
    });
    expect(r2.totalDeltas).toBe(0);
  });

  it.each([
    { label: "missing adapter", openHermesDb: undefined, expectedWarn: "not available" },
    { label: "returns null", openHermesDb: () => null, expectedWarn: "Failed to open" },
    {
      label: "querySessions throws",
      openHermesDb: () => ({
        querySessions: () => {
          throw new Error("DB corrupted");
        },
        close: () => {},
      }),
      expectedWarn: "Skipping",
    },
  ])("warns gracefully for Hermes DB when $label", async ({ openHermesDb, expectedWarn }) => {
    const dbPath = await writeFileEnsured(join(dataDir, "hermes/state.db"), "dummy");
    const events: SyncProgressEvent[] = [];
    const result = await executeSync({
      stateDir,
      hermesDbPath: dbPath,
      openHermesDb,
      onProgress: (e) => events.push(e),
    });
    expect(result.sources.hermes).toBe(0);
    expect(
      events.some(
        (e) => e.source === "hermes" && e.phase === "warn" && e.message?.includes(expectedWarn),
      ),
    ).toBe(true);
  });

  it("handles Hermes cursor loss, inode change, and flat cursor migration", async () => {
    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-h/session.jsonl"),
      `${claudeLine("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
    );
    const dbPath = await writeFileEnsured(join(dataDir, "hermes/state.db"), "dummy");
    const opts = {
      stateDir,
      claudeDir: join(dataDir, ".claude"),
      hermesDbPath: dbPath,
      openHermesDb: mockOpenHermesDb([hermesRow("ses-h1", 5000, 800)]),
    };
    await executeSync(opts);

    const store = new CursorStore(stateDir);
    // 1) Cursor lost
    const c1 = (await store.load()) as unknown as Record<string, unknown>;
    delete c1.hermesSqlite;
    await store.save(c1 as never);
    const evLoss: SyncProgressEvent[] = [];
    await executeSync({ ...opts, onProgress: (e) => evLoss.push(e) });
    expect(evLoss.some((e) => e.phase === "warn" && e.message?.includes("cursor entry lost"))).toBe(
      true,
    );

    // 2) Inode change
    const c2 = (await store.load()) as unknown as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    c2.hermesSqlite!.default!.inode = 999999;
    await store.save(c2 as never);
    const evInode: SyncProgressEvent[] = [];
    await executeSync({ ...opts, onProgress: (e) => evInode.push(e) });
    expect(evInode.some((e) => e.phase === "warn" && e.message?.includes("inode changed"))).toBe(
      true,
    );

    // 3) Flat cursor migration
    const cursorsPath = join(stateDir, "cursors.json");
    const raw = JSON.parse(await readFile(cursorsPath, "utf-8"));
    raw.hermesSqlite = {
      ...raw.hermesSqlite.default,
      sessionTotals: raw.hermesSqlite.default.sessionTotals ?? {},
    };
    await writeFile(cursorsPath, JSON.stringify(raw));
    const evMig: SyncProgressEvent[] = [];
    await executeSync({ ...opts, onProgress: (e) => evMig.push(e) });
    expect(evMig.some((e) => e.phase === "warn" && e.message?.includes("multi-profile"))).toBe(
      true,
    );
  });

  // ===== Pruning, parse-throw isolation, and legacy Claude cursor =====

  it("prunes symlink alias and deleted-file cursors while preserving OpenCode mtime-skipped cursors", async () => {
    const realCodexDir = join(dataDir, "codex-sessions");
    const aliasCodexDir = join(dataDir, "multica/run-7/codex-home/sessions");
    const realCodexPath = await writeFileEnsured(
      join(realCodexDir, "2026/03/07/rollout-canon.jsonl"),
      `${codexLines("2026-03-07T10:15:00.000Z", 1000, 100)}\n`,
    );
    await mkdir(join(dataDir, "multica/run-7/codex-home"), { recursive: true });
    await symlink(realCodexDir, aliasCodexDir);
    const aliasCodexPath = join(aliasCodexDir, "2026/03/07/rollout-canon.jsonl");

    await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-c/session.jsonl"),
      `${claudeLine("2026-03-07T10:00:00.000Z", 50, 5)}\n`,
    );
    const ocDir = join(dataDir, "opencode/message/ses_protect");
    const realOcPath = await writeFileEnsured(
      join(ocDir, "msg_001.json"),
      opencodeMsg(1771120749059, 100, 50),
    );

    const opts = {
      stateDir,
      deviceId: "dev-1",
      codexSessionsDir: realCodexDir,
      claudeDir: join(dataDir, ".claude"),
      openCodeMessageDir: join(dataDir, "opencode/message"),
    };
    await executeSync(opts);

    const cursorsPath = join(stateDir, "cursors.json");
    const c = JSON.parse(await readFile(cursorsPath, "utf-8"));
    const ghostPath = join(dataDir, "vanished/session.jsonl");
    const protectedFake = join(ocDir, "msg_does_not_exist.json");
    c.files[aliasCodexPath] = { ...c.files[realCodexPath] };
    c.knownFilePaths[aliasCodexPath] = true;
    c.files[ghostPath] = {
      inode: 7_777_777,
      mtimeMs: 0,
      size: 0,
      offset: 0,
      updatedAt: "2026-03-07T09:00:00.000Z",
    };
    c.knownFilePaths[ghostPath] = true;
    c.files[protectedFake] = {
      inode: 12_345_678,
      mtimeMs: 0,
      size: 0,
      lastTotals: null,
      messageKey: null,
      updatedAt: "2026-03-07T09:00:00.000Z",
    };
    c.knownFilePaths[protectedFake] = true;
    await writeFile(cursorsPath, JSON.stringify(c));

    await executeSync(opts);
    const after = JSON.parse(await readFile(cursorsPath, "utf-8"));
    expect(after.files[realCodexPath]).toBeDefined();
    expect(after.files[aliasCodexPath]).toBeUndefined();
    expect(after.knownFilePaths[aliasCodexPath]).toBeUndefined();
    expect(after.files[ghostPath]).toBeUndefined();
    expect(after.knownFilePaths[ghostPath]).toBeUndefined();
    expect(after.files[realOcPath]).toBeDefined();
    expect(after.files[protectedFake]).toBeDefined();

    // Subsequent new OpenCode message produces only incremental delta (no double-count)
    const future = new Date(Date.now() + 2000);
    await writeFile(join(ocDir, "msg_002.json"), opencodeMsg(1771120799059, 200, 100));
    await utimes(ocDir, future, future);
    await executeSync(opts);
    const ocTotals = (await readQueue(stateDir))
      .filter((r) => r.source === "opencode")
      .reduce((s, r) => s + r.input_tokens, 0);
    expect(ocTotals).toBe(300);
  });

  it("does not record knownFilePaths for a file whose parser throws", async () => {
    const goodPath = await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-throw/good.jsonl"),
      `${claudeLine("2026-03-07T10:00:00.000Z", 1000, 100)}\n`,
    );
    const badPath = await writeFileEnsured(
      join(dataDir, ".claude/projects/proj-throw/bad.jsonl"),
      `${claudeLine("2026-03-07T10:05:00.000Z", 2000, 200)}\n`,
    );

    const claudeParser = await import("../parsers/claude.js");
    const orig = claudeParser.parseClaudeFile;
    const spy = vi.spyOn(claudeParser, "parseClaudeFile").mockImplementation(async (opts) => {
      if (opts.filePath === badPath) throw new Error("Simulated parser explosion");
      return orig(opts);
    });
    const events: SyncProgressEvent[] = [];
    try {
      await executeSync({ stateDir, deviceId: "dev-1", claudeDir: join(dataDir, ".claude") });
      const c1 = JSON.parse(await readFile(join(stateDir, "cursors.json"), "utf-8"));
      expect(c1.files[goodPath]).toBeDefined();
      expect(c1.knownFilePaths[badPath]).toBeUndefined();

      await executeSync({
        stateDir,
        deviceId: "dev-1",
        claudeDir: join(dataDir, ".claude"),
        onProgress: (e) => events.push(e),
      });
      expect(events.some((e) => e.message?.includes("Cursor entry lost"))).toBe(false);
    } finally {
      spy.mockRestore();
    }

    const r3 = await executeSync({
      stateDir,
      deviceId: "dev-1",
      claudeDir: join(dataDir, ".claude"),
    });
    expect(r3.sources.claude).toBe(1);
    const claudeTotal = (await readQueue(stateDir))
      .filter((r) => r.source === "claude-code")
      .reduce((s, r) => s + r.input_tokens, 0);
    expect(claudeTotal).toBe(3000);
  });

  describe("legacy Claude cursor upgrade path", () => {
    async function seedLegacyState(filePath: string) {
      const st = await stat(filePath);
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "cursors.json"),
        JSON.stringify({
          version: 1,
          files: {
            [filePath]: {
              inode: st.ino,
              mtimeMs: st.mtimeMs,
              size: st.size,
              offset: st.size,
              updatedAt: "2026-06-01T10:01:00.000Z",
            },
          },
          knownFilePaths: { [filePath]: true },
          knownDbSources: {},
          updatedAt: "2026-06-01T10:01:00.000Z",
        }),
      );
      await writeFile(
        join(stateDir, "queue.jsonl"),
        `${JSON.stringify({
          source: "claude-code",
          model: "glm-5",
          hour_start: "2026-06-01T10:00:00.000Z",
          device_id: "dev-legacy",
          input_tokens: 100,
          cached_input_tokens: 0,
          output_tokens: 50,
          reasoning_output_tokens: 0,
          total_tokens: 150,
        })}\n`,
      );
    }

    it("does not double-count on message rewrite or shared sibling message.id", async () => {
      // Case A: rewrite in same file after legacy offset
      const claudeRootA = join(dataDir, "case-a/.claude");
      const fileA = await writeFileEnsured(
        join(claudeRootA, "projects/p1/A.jsonl"),
        `${claudeLine("2026-06-01T10:00:00.000Z", 100, 50, "msg_A")}\n`,
      );
      await seedLegacyState(fileA);
      await appendFile(fileA, `${claudeLine("2026-06-01T10:00:30.000Z", 100, 50, "msg_A")}\n`);
      await executeSync({ stateDir, deviceId: "dev-legacy", claudeDir: claudeRootA });

      expect((await readQueue(stateDir)).find((r) => r.source === "claude-code")).toMatchObject({
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      });
      expect(
        JSON.parse(await readFile(join(stateDir, "cursors.json"), "utf-8")).files[fileA].seenIds,
      ).toBeDefined();

      // Case B: unchanged legacy file + new sibling file sharing same message.id
      const stateDirB = join(tempDir, "state-b");
      const claudeRootB = join(dataDir, "case-b/.claude");
      const fileB1 = await writeFileEnsured(
        join(claudeRootB, "projects/p1/A.jsonl"),
        `${claudeLine("2026-06-01T10:00:00.000Z", 100, 50, "msg_cross")}\n`,
      );
      const stB1 = await stat(fileB1);
      await mkdir(stateDirB, { recursive: true });
      await writeFile(
        join(stateDirB, "cursors.json"),
        JSON.stringify({
          version: 1,
          files: {
            [fileB1]: {
              inode: stB1.ino,
              mtimeMs: stB1.mtimeMs,
              size: stB1.size,
              offset: stB1.size,
              updatedAt: "2026-06-01T10:01:00.000Z",
            },
          },
          knownFilePaths: { [fileB1]: true },
          knownDbSources: {},
          updatedAt: "2026-06-01T10:01:00.000Z",
        }),
      );
      await writeFile(
        join(stateDirB, "queue.jsonl"),
        `${JSON.stringify({ source: "claude-code", model: "glm-5", hour_start: "2026-06-01T10:00:00.000Z", device_id: "dev-legacy", input_tokens: 100, cached_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 150 })}\n`,
      );
      await writeFileEnsured(
        join(claudeRootB, "projects/p1/B.jsonl"),
        `${claudeLine("2026-06-01T10:00:30.000Z", 100, 50, "msg_cross")}\n`,
      );
      await executeSync({ stateDir: stateDirB, deviceId: "dev-legacy", claudeDir: claudeRootB });
      expect((await readQueue(stateDirB)).find((r) => r.source === "claude-code")).toMatchObject({
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      });
    });
  });
});

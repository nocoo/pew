import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSync } from "../commands/sync.js";

const race = vi.hoisted(() => ({
  enabled: false,
  paths: new Set<string>(),
}));

vi.mock("../drivers/registry.js", async (importOriginal) => {
  const { writeFile } = await import("node:fs/promises");
  const orig = await importOriginal<typeof import("../drivers/registry.js")>();
  return {
    ...orig,
    createTokenDrivers(opts: Parameters<typeof orig.createTokenDrivers>[0]) {
      const drivers = orig.createTokenDrivers(opts);
      for (const driver of drivers.fileDrivers) {
        const inner = driver.parse.bind(driver);
        driver.parse = async (filePath, resume, ctx) => {
          const result = await inner(filePath, resume, ctx);
          if (race.enabled && race.paths.has(filePath)) {
            await writeFile(filePath, `{"rewritten":true}\n`);
          }
          return result;
        };
      }
      return drivers;
    },
  };
});

const SID = "019f4975-8cf2-7fc2-9d8a-a4297c3a01a7";

function grokLine(ts: string, prompt: number): string {
  return JSON.stringify({
    ts,
    src: "shell",
    sid: SID,
    msg: "shell.turn.inference_done",
    ctx: {
      loop_index: 1,
      attempts: 1,
      prompt_tokens: prompt,
      cached_prompt_tokens: 0,
      completion_tokens: 10,
      reasoning_tokens: 0,
    },
  });
}

function codexGoalSessionMeta(id: string): string {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-03-07T10:00:00.000Z",
    payload: { id, model: "gpt-5.4", source: "vscode" },
  });
}

function codexTokenLine(opts: {
  input: number;
  output: number;
  lastInput: number;
  lastOutput: number;
  timestamp?: string;
}): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp: opts.timestamp ?? "2026-03-07T10:15:30.000Z",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: opts.input,
          cached_input_tokens: 0,
          output_tokens: opts.output,
          reasoning_output_tokens: 0,
        },
        last_token_usage: {
          input_tokens: opts.lastInput,
          cached_input_tokens: 0,
          output_tokens: opts.lastOutput,
          reasoning_output_tokens: 0,
        },
      },
    },
  });
}

async function grokQueueInput(stateDir: string): Promise<number> {
  const raw = await readFile(join(stateDir, "queue.jsonl"), "utf8").catch(() => "");
  if (!raw.trim()) return 0;
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { source: string; input_tokens: number })
    .filter((row) => row.source === "grok")
    .reduce((sum, row) => sum + row.input_tokens, 0);
}

async function codexQueueInput(stateDir: string): Promise<number> {
  const raw = await readFile(join(stateDir, "queue.jsonl"), "utf8").catch(() => "");
  if (!raw.trim()) return 0;
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { source: string; input_tokens: number })
    .filter((row) => row.source === "codex")
    .reduce((sum, row) => sum + row.input_tokens, 0);
}

describe("executeSync jsonl snapshot race", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-jsonl-race-"));
    stateDir = join(tempDir, "state");
    race.enabled = false;
    race.paths.clear();
  });

  afterEach(async () => {
    race.enabled = false;
    race.paths.clear();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("leaves grok cursor, anchors, and queue unchanged when the file is rewritten after parse", async () => {
    const grokLog = join(tempDir, "unified.jsonl");
    const firstBody = `${[
      grokLine("2026-03-07T10:00:00.000Z", 100),
      grokLine("2026-03-07T10:01:00.000Z", 200),
    ].join("\n")}\n`;
    await writeFile(grokLog, firstBody);
    const first = await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
    });
    expect(first.sources.grok).toBe(2);
    expect(await grokQueueInput(stateDir)).toBe(300);

    const cursorsPath = join(stateDir, "cursors.json");
    const before = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<
        string,
        { offset: number; continuityAnchors?: unknown[]; size: number }
      >;
    };
    const beforeCursor = before.files[grokLog];

    await writeFile(
      grokLog,
      `${firstBody}${grokLine("2026-03-07T10:02:00.000Z", 400)}\n`,
    );
    race.paths.add(grokLog);
    race.enabled = true;
    const second = await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
    });
    expect(second.sources.grok).toBe(0);
    expect(await grokQueueInput(stateDir)).toBe(300);

    const after = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<
        string,
        { offset: number; continuityAnchors?: unknown[]; size: number }
      >;
    };
    expect(after.files[grokLog]?.offset).toBe(beforeCursor?.offset);
    expect(after.files[grokLog]?.size).toBe(beforeCursor?.size);
    expect(after.files[grokLog]?.continuityAnchors).toEqual(
      beforeCursor?.continuityAnchors,
    );
  });

  it("rolls back Codex shared scope state when a child parse is discarded", async () => {
    const sessionsDir = join(tempDir, "sessions");
    const dayDir = join(sessionsDir, "2026", "03", "07");
    await mkdir(dayDir, { recursive: true });
    const goalId = "019f9edc-bc7f-7ef1-8d32-35f66809b013";
    const parentThreadId = "019fbeda-8b7d-7b13-9eb3-87cecc4607e9";
    const childThreadId = "019fbf71-32f5-70d3-9113-2f8b4430656e";
    const parentPath = join(
      dayDir,
      `rollout-2026-03-07T10-00-00-${parentThreadId}.jsonl`,
    );
    const childPath = join(
      dayDir,
      `rollout-2026-03-07T10-30-00-${childThreadId}.jsonl`,
    );
    const parentBody = `${[
      codexGoalSessionMeta(goalId),
      codexTokenLine({
        input: 100,
        output: 10,
        lastInput: 100,
        lastOutput: 10,
      }),
    ].join("\n")}\n`;
    const childBody = `${[
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-03-07T10:30:00.000Z",
        payload: {
          id: childThreadId,
          model: "gpt-5.4",
          source: {
            subagent: { thread_spawn: { parent_thread_id: parentThreadId } },
          },
        },
      }),
      codexTokenLine({
        input: 100,
        output: 10,
        lastInput: 100,
        lastOutput: 10,
        timestamp: "2026-03-07T10:30:00.000Z",
      }),
    ].join("\n")}\n`;
    await writeFile(parentPath, parentBody);
    await writeFile(childPath, childBody);

    const first = await executeSync({
      stateDir,
      deviceId: "dev-1",
      codexSessionsDir: sessionsDir,
    });
    expect(first.sources.codex).toBeGreaterThan(0);
    expect(await codexQueueInput(stateDir)).toBe(100);

    const cursorsPath = join(stateDir, "cursors.json");
    const before = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<string, { offset: number; continuityAnchors?: unknown[] }>;
      codexScopes?: Record<string, { usageKeys: string[]; totals: unknown }>;
    };
    const beforeKeys = before.codexScopes?.[goalId]?.usageKeys ?? [];
    expect(beforeKeys.length).toBeGreaterThan(0);

    await writeFile(
      childPath,
      `${childBody}${codexTokenLine({
        input: 200,
        output: 20,
        lastInput: 100,
        lastOutput: 10,
        timestamp: "2026-03-07T10:45:00.000Z",
      })}\n`,
    );
    race.paths.add(childPath);
    race.enabled = true;
    const second = await executeSync({
      stateDir,
      deviceId: "dev-1",
      codexSessionsDir: sessionsDir,
    });
    expect(second.sources.codex).toBe(0);
    expect(await codexQueueInput(stateDir)).toBe(100);

    const after = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<string, { offset: number; continuityAnchors?: unknown[] }>;
      codexScopes?: Record<string, { usageKeys: string[]; totals: unknown }>;
    };
    expect(after.files[childPath]?.offset).toBe(before.files[childPath]?.offset);
    expect(after.files[childPath]?.continuityAnchors).toEqual(
      before.files[childPath]?.continuityAnchors,
    );
    expect(after.codexScopes?.[goalId]?.usageKeys).toEqual(beforeKeys);
  });
});

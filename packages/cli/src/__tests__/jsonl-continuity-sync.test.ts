import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeSync } from "../commands/sync.js";

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

function piLine(ts: string, input: number): string {
  return JSON.stringify({
    type: "message",
    id: `msg-${ts}`,
    timestamp: ts,
    message: {
      role: "assistant",
      model: "claude-opus-4.6-1m",
      usage: { input, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: input + 1 },
    },
  });
}

function claudeLine(ts: string, input: number): string {
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
        output_tokens: 1,
      },
    },
  });
}

async function grokQueueInput(stateDir: string): Promise<number> {
  const raw = await readFile(join(stateDir, "queue.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { source: string; input_tokens: number })
    .filter((row) => row.source === "grok")
    .reduce((sum, row) => sum + row.input_tokens, 0);
}

describe("jsonl continuity through executeSync", () => {
  let tempDir: string;
  let stateDir: string;
  let grokLog: string;
  let claudeDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-jsonl-cont-"));
    stateDir = join(tempDir, "state");
    grokLog = join(tempDir, "unified.jsonl");
    claudeDir = join(tempDir, ".claude");
    const claudeProj = join(claudeDir, "projects", "p1");
    await mkdir(claudeProj, { recursive: true });
    await writeFile(
      join(claudeProj, "s.jsonl"),
      `${claudeLine("2026-03-07T10:00:00.000Z", 7)}\n`,
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("counts only new events after a same-inode retained-suffix trim", async () => {
    const kept = [
      grokLine("2026-03-07T10:00:00.000Z", 100),
      grokLine("2026-03-07T10:01:00.000Z", 200),
      grokLine("2026-03-07T10:02:00.000Z", 300),
    ];
    const dropped = grokLine("2026-03-07T09:59:00.000Z", 50);
    await writeFile(grokLog, `${dropped}\n${kept.join("\n")}\n`);

    const first = await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });
    expect(first.sources.grok).toBe(4);
    expect(first.sources.claude).toBe(1);
    expect(await grokQueueInput(stateDir)).toBe(650);

    const added = grokLine("2026-03-07T10:03:00.000Z", 400);
    await writeFile(grokLog, `${kept.join("\n")}\n${added}\n`);

    const warnings: string[] = [];
    const second = await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
      onProgress: (event) => {
        if (event.phase === "warn" && event.message) warnings.push(event.message);
      },
    });
    expect(warnings.some((m) => m.includes("continuity lost"))).toBe(false);
    expect(second.sources.grok).toBe(1);
    expect(second.sources.claude).toBe(0);
    expect(await grokQueueInput(stateDir)).toBe(1050);
  });

  it("does not replay a clear rewrite and leaves other sources untouched", async () => {
    await writeFile(
      grokLog,
      `${[
        grokLine("2026-03-07T10:00:00.000Z", 100),
        grokLine("2026-03-07T10:01:00.000Z", 200),
        grokLine("2026-03-07T10:02:00.000Z", 300),
      ].join("\n")}\n`,
    );
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });

    await writeFile(
      grokLog,
      `${[
        grokLine("2026-03-08T10:00:00.000Z", 9),
        grokLine("2026-03-08T10:01:00.000Z", 9),
        grokLine("2026-03-08T10:02:00.000Z", 9),
      ].join("\n")}\n`,
    );

    const warnings: string[] = [];
    const second = await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
      onProgress: (event) => {
        if (event.phase === "warn" && event.message) warnings.push(event.message);
      },
    });
    expect(warnings.some((m) => m.includes("continuity lost") && m.includes("grok"))).toBe(
      true,
    );
    expect(second.sources.grok).toBe(0);
    expect(second.sources.claude).toBe(0);
    expect(await grokQueueInput(stateDir)).toBe(600);

    const cursors = JSON.parse(
      await readFile(join(stateDir, "cursors.json"), "utf8"),
    ) as { files: Record<string, { offset: number; continuityBroken?: boolean }> };
    expect(cursors.files[grokLog]?.continuityBroken).toBe(true);
    expect(cursors.files[grokLog]?.offset).toBeLessThanOrEqual(
      (await stat(grokLog)).size,
    );
  });

  it("rebases a pi jsonl after a same-inode suffix trim", async () => {
    const piDir = join(tempDir, "pi-sessions");
    await mkdir(piDir, { recursive: true });
    const piFile = join(piDir, "s.jsonl");
    const kept = [
      piLine("2026-03-07T11:00:00.000Z", 10),
      piLine("2026-03-07T11:01:00.000Z", 20),
      piLine("2026-03-07T11:02:00.000Z", 30),
    ];
    await writeFile(piFile, `${piLine("2026-03-07T10:59:00.000Z", 5)}\n${kept.join("\n")}\n`);
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      piSessionsDir: piDir,
      claudeDir,
    });

    await writeFile(piFile, `${kept.join("\n")}\n${piLine("2026-03-07T11:03:00.000Z", 40)}\n`);
    const second = await executeSync({
      stateDir,
      deviceId: "dev-1",
      piSessionsDir: piDir,
      claudeDir,
    });
    expect(second.sources.pi).toBe(1);
  });

  it("stamps anchors onto an unchanged legacy cursor", async () => {
    await writeFile(grokLog, `${grokLine("2026-03-07T10:00:00.000Z", 100)}\n`);
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });
    const cursorsPath = join(stateDir, "cursors.json");
    const cursors = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<string, { continuityAnchors?: unknown[] }>;
    };
    delete cursors.files[grokLog]!.continuityAnchors;
    await writeFile(cursorsPath, `${JSON.stringify(cursors)}\n`);

    await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });
    const after = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<string, { continuityAnchors?: unknown[] }>;
    };
    expect(after.files[grokLog]?.continuityAnchors?.length).toBeGreaterThan(0);
    expect(await grokQueueInput(stateDir)).toBe(100);
  });

  it("recovers after an observed empty epoch", async () => {
    await writeFile(
      grokLog,
      `${[
        grokLine("2026-03-07T10:00:00.000Z", 100),
        grokLine("2026-03-07T10:01:00.000Z", 200),
      ].join("\n")}\n`,
    );
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });
    await writeFile(grokLog, "");
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });
    await writeFile(grokLog, `${grokLine("2026-03-07T12:00:00.000Z", 15)}\n`);
    const third = await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });
    expect(third.sources.grok).toBe(1);
    expect(await grokQueueInput(stateDir)).toBe(315);
  });

  it("does not keep a poisoned offset sticky on an unchanged file", async () => {
    const body = `${grokLine("2026-03-07T10:00:00.000Z", 100)}\n`;
    await writeFile(grokLog, body);
    await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });

    const cursorsPath = join(stateDir, "cursors.json");
    const cursors = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<string, Record<string, unknown>>;
    };
    cursors.files[grokLog]!.offset = 5240354;
    await writeFile(cursorsPath, `${JSON.stringify(cursors, null, 2)}\n`);

    await executeSync({
      stateDir,
      deviceId: "dev-1",
      grokLogsPath: grokLog,
      claudeDir,
    });
    const after = JSON.parse(await readFile(cursorsPath, "utf8")) as {
      files: Record<string, { offset: number }>;
    };
    const size = (await stat(grokLog)).size;
    expect(after.files[grokLog]!.offset).toBe(size);
    expect(after.files[grokLog]!.offset).not.toBe(5240354);
    expect(await grokQueueInput(stateDir)).toBe(100);
  });
});

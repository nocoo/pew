import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stat } from "node:fs/promises";
import { grokTokenDriver } from "../../../drivers/token/grok-token-driver.js";
import type { ByteOffsetCursor, FileFingerprint } from "../../../drivers/types.js";

function inferenceLine(ts: string, prompt = 100, cached = 40, out = 10, rea = 2): string {
  return JSON.stringify({
    ts,
    sid: "sid-1",
    msg: "shell.turn.inference_done",
    ctx: {
      prompt_tokens: prompt,
      cached_prompt_tokens: cached,
      completion_tokens: out,
      reasoning_tokens: rea,
      loop_index: 1,
      attempts: 1,
    },
  });
}

async function fingerprint(path: string): Promise<FileFingerprint> {
  const st = await stat(path);
  return {
    inode: (st as unknown as { ino: number }).ino,
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
}

describe("grokTokenDriver", () => {
  let root: string;
  let logPath: string;
  let sessionsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pew-grok-token-drv-"));
    const logsDir = join(root, "logs");
    sessionsDir = join(root, "sessions");
    await mkdir(logsDir, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    logPath = join(logsDir, "unified.jsonl");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers the unified log when present", async () => {
    await writeFile(logPath, "");
    const files = await grokTokenDriver.discover({ grokLogsPath: logPath }, {});
    expect(files).toEqual([logPath]);
  });

  it("returns empty when log missing", async () => {
    const files = await grokTokenDriver.discover(
      { grokLogsPath: join(root, "nope.jsonl") },
      {},
    );
    expect(files).toEqual([]);
  });

  it("first sync emits all complete lines", async () => {
    await writeFile(
      logPath,
      [
        inferenceLine("2026-07-10T00:01:00.000Z"),
        inferenceLine("2026-07-10T00:02:00.000Z"),
      ].join("\n") + "\n",
    );
    const fp = await fingerprint(logPath);
    const resume = grokTokenDriver.resumeState(undefined, fp);
    const result = await grokTokenDriver.parse(logPath, resume, {});
    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0]!.source).toBe("grok");
  });

  it("second sync with unchanged file shouldSkip", async () => {
    await writeFile(logPath, inferenceLine("2026-07-10T00:01:00.000Z") + "\n");
    const fp = await fingerprint(logPath);
    const resume = grokTokenDriver.resumeState(undefined, fp);
    const result = await grokTokenDriver.parse(logPath, resume, {});
    const cursor = grokTokenDriver.buildCursor(fp, result);
    expect(grokTokenDriver.shouldSkip(cursor as ByteOffsetCursor, fp)).toBe(true);
  });

  it("incremental append only emits new lines", async () => {
    const line1 = inferenceLine("2026-07-10T00:01:00.000Z") + "\n";
    await writeFile(logPath, line1);
    const fp1 = await fingerprint(logPath);
    const r1 = await grokTokenDriver.parse(
      logPath,
      grokTokenDriver.resumeState(undefined, fp1),
      {},
    );
    expect(r1.deltas).toHaveLength(1);
    const cursor = grokTokenDriver.buildCursor(fp1, r1) as ByteOffsetCursor;

    const line2 = inferenceLine("2026-07-10T00:02:00.000Z") + "\n";
    await writeFile(logPath, line1 + line2);
    const fp2 = await fingerprint(logPath);
    const r2 = await grokTokenDriver.parse(
      logPath,
      grokTokenDriver.resumeState(cursor, fp2),
      {},
    );
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0]!.timestamp).toBe("2026-07-10T00:02:00.000Z");
  });

  it("partial-line round-trip: incomplete line not emitted until completed", async () => {
    const complete = inferenceLine("2026-07-10T00:01:00.000Z") + "\n";
    const partial = inferenceLine("2026-07-10T00:02:00.000Z").slice(0, 30);
    await writeFile(logPath, complete + partial);

    const fp1 = await fingerprint(logPath);
    const r1 = await grokTokenDriver.parse(
      logPath,
      grokTokenDriver.resumeState(undefined, fp1),
      {},
    );
    expect(r1.deltas).toHaveLength(1);
    const cursor = grokTokenDriver.buildCursor(fp1, r1) as ByteOffsetCursor;
    expect(cursor.offset).toBe(Buffer.byteLength(complete, "utf8"));

    const rest = inferenceLine("2026-07-10T00:02:00.000Z").slice(30) + "\n";
    await writeFile(logPath, complete + partial + rest);
    const fp2 = await fingerprint(logPath);
    const r2 = await grokTokenDriver.parse(
      logPath,
      grokTokenDriver.resumeState(cursor, fp2),
      {},
    );
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0]!.timestamp).toBe("2026-07-10T00:02:00.000Z");
  });

  it("uses fast-path model from sessions signals.json", async () => {
    const sid = "sid-1";
    const sessionDir = join(sessionsDir, "%2Ftmp", sid);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "signals.json"),
      JSON.stringify({ modelsUsed: ["grok-4.5"], primaryModelId: "grok-4.5" }),
    );
    await writeFile(logPath, inferenceLine("2026-07-10T00:01:00.000Z") + "\n");

    const fp = await fingerprint(logPath);
    const result = await grokTokenDriver.parse(
      logPath,
      grokTokenDriver.resumeState(undefined, fp),
      {},
    );
    expect(result.deltas[0]!.model).toBe("grok-4.5");
  });

  it("honours grokSessionsDir override via SyncContext (not only sibling path)", async () => {
    // Put sessions far from the log so sibling fallback would miss them
    const overrideSessions = join(root, "elsewhere", "sessions");
    const sid = "sid-1";
    const sessionDir = join(overrideSessions, "%2Ftmp", sid);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "signals.json"),
      JSON.stringify({ modelsUsed: ["grok-override"], primaryModelId: "grok-override" }),
    );
    await writeFile(logPath, inferenceLine("2026-07-10T00:01:00.000Z") + "\n");

    const ctx: Record<string, unknown> = {};
    await grokTokenDriver.discover(
      { grokLogsPath: logPath, grokSessionsDir: overrideSessions },
      ctx as never,
    );
    expect(ctx.grokSessionsDir).toBe(overrideSessions);

    const fp = await fingerprint(logPath);
    const result = await grokTokenDriver.parse(
      logPath,
      grokTokenDriver.resumeState(undefined, fp),
      ctx as never,
    );
    expect(result.deltas[0]!.model).toBe("grok-override");
  });
});

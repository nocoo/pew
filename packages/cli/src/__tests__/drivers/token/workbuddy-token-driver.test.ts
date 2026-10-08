import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { workbuddyTokenDriver } from "../../../drivers/token/workbuddy-token-driver.js";
import type { ByteOffsetCursor, FileFingerprint } from "../../../drivers/types.js";

const TS_MS = 1757491200000; // 2025-09-10T08:00:00.000Z

function wbLine(messageId: string, tsMs = TS_MS): string {
  return JSON.stringify({
    type: "function_call",
    sessionId: "session-1",
    cwd: "/Users/someone/WorkBuddy/2026-09-10-14-51-14",
    timestamp: tsMs,
    providerData: {
      agent: "cli",
      messageId,
      model: "hy4-preview",
      rawUsage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        prompt_cache_hit_tokens: 400,
        prompt_cache_miss_tokens: 600,
        completion_thinking_tokens: 50,
      },
      usage: { requests: 1, inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
    },
  });
}

async function fingerprint(path: string): Promise<FileFingerprint> {
  const st = await stat(path);
  return {
    inode: (st as unknown as { ino: number }).inode,
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
}

describe("workbuddyTokenDriver", () => {
  let root: string;
  let slugDir: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pew-workbuddy-token-drv-"));
    slugDir = join(root, "projects", "Users-someone-WorkBuddy-2026-09-10");
    await mkdir(slugDir, { recursive: true });
    file = join(slugDir, "session-1.jsonl");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers session files under projects/<slug>/", async () => {
    await writeFile(file, `${wbLine("m1")}\n`);
    const files = await workbuddyTokenDriver.discover({ workbuddyDir: root }, {});
    expect(files).toEqual([file]);
  });

  it("returns empty when the directory option is absent or missing", async () => {
    expect(await workbuddyTokenDriver.discover({}, {})).toEqual([]);
    expect(
      await workbuddyTokenDriver.discover({ workbuddyDir: join(root, "nope") }, {}),
    ).toEqual([]);
  });

  it("first sync emits all usage records", async () => {
    await writeFile(file, `${wbLine("m1")}\n${wbLine("m2")}\n`);
    const fp = await fingerprint(file);
    const result = await workbuddyTokenDriver.parse(
      file,
      workbuddyTokenDriver.resumeState(undefined, fp),
      {},
    );
    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0]!.source).toBe("workbuddy");
  });

  it("second sync with an unchanged file fast-skips", async () => {
    await writeFile(file, `${wbLine("m1")}\n`);
    const fp = await fingerprint(file);
    const result = await workbuddyTokenDriver.parse(
      file,
      workbuddyTokenDriver.resumeState(undefined, fp),
      {},
    );
    const cursor = workbuddyTokenDriver.buildCursor(fp, result);
    expect(workbuddyTokenDriver.shouldSkip(cursor, fp)).toBe(true);
  });

  it("incremental append only emits new records", async () => {
    const line1 = `${wbLine("m1")}\n`;
    await writeFile(file, line1);
    const fp1 = await fingerprint(file);
    const r1 = await workbuddyTokenDriver.parse(
      file,
      workbuddyTokenDriver.resumeState(undefined, fp1),
      {},
    );
    expect(r1.deltas).toHaveLength(1);
    const cursor = workbuddyTokenDriver.buildCursor(fp1, r1) as ByteOffsetCursor;
    expect(cursor.offset).toBe(Buffer.byteLength(line1, "utf8"));

    const line2 = `${wbLine("m2", TS_MS + 60_000)}\n`;
    await writeFile(file, line1 + line2);
    const fp2 = await fingerprint(file);
    const r2 = await workbuddyTokenDriver.parse(
      file,
      workbuddyTokenDriver.resumeState(cursor, fp2),
      {},
    );
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0]!.timestamp).toBe("2025-09-10T08:01:00.000Z");
  });

  it("resets the offset to 0 when the file inode changes", async () => {
    const fp = { inode: 1, mtimeMs: 0, size: 100 };
    const stale = { inode: 2, mtimeMs: 0, size: 100, offset: 90, updatedAt: "" };
    const resume = workbuddyTokenDriver.resumeState(stale, fp);
    expect(resume).toMatchObject({ kind: "byte-offset", startOffset: 0 });
  });
});

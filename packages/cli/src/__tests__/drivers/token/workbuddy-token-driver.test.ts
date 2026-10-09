import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { workbuddyTokenDriver } from "../../../drivers/token/workbuddy-token-driver.js";
import type { WorkbuddyCursor, FileCursorBase } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

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
    const files = await workbuddyTokenDriver.discover({ workbuddyDirs: [root] }, {});
    expect(files).toEqual([file]);
  });

  it("discovers sessions from every configured root (domestic + international)", async () => {
    const domRoot = root;
    const intlRoot = await mkdtemp(join(tmpdir(), "pew-workbuddy-intl-"));
    const domFile = join(domRoot, "projects", "Users-me-a", "s1.jsonl");
    const intlFile = join(intlRoot, "projects", "Users-me-b", "s2.jsonl");
    await mkdir(join(domRoot, "projects", "Users-me-a"), { recursive: true });
    await mkdir(join(intlRoot, "projects", "Users-me-b"), { recursive: true });
    await writeFile(domFile, `${wbLine("m1")}\n`);
    await writeFile(intlFile, `${wbLine("m2")}\n`);

    try {
      const files = await workbuddyTokenDriver.discover(
        { workbuddyDirs: [domRoot, intlRoot] },
        {},
      );
      expect(files).toEqual([domFile, intlFile].sort());
    } finally {
      await rm(intlRoot, { recursive: true, force: true });
    }
  });

  it("returns empty when the directory option is absent or missing", async () => {
    expect(await workbuddyTokenDriver.discover({}, {})).toEqual([]);
    expect(
      await workbuddyTokenDriver.discover({ workbuddyDirs: [join(root, "nope")] }, {}),
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
    const cursor = workbuddyTokenDriver.buildCursor(fp1, r1) as WorkbuddyCursor;
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
    expect(resume).toMatchObject({ kind: "workbuddy", startOffset: 0 });
  });

  it("dedups a messageId shared across two files in one sync (cross-file)", async () => {
    const copy = join(slugDir, "session-2.jsonl");
    await writeFile(file, `${wbLine("shared")}\n`);
    await writeFile(copy, `${wbLine("shared")}\n`);

    const ctx = {};
    const fpA = await fingerprint(file);
    const fpB = await fingerprint(copy);
    const rA = await workbuddyTokenDriver.parse(
      file,
      workbuddyTokenDriver.resumeState(undefined, fpA),
      ctx,
    );
    const rB = await workbuddyTokenDriver.parse(
      copy,
      workbuddyTokenDriver.resumeState(undefined, fpB),
      ctx,
    );

    expect(rA.deltas).toHaveLength(1);
    expect(rB.deltas).toHaveLength(0);
  });

  it("persists emitted messageIds on the cursor and suppresses a cross-run replay", async () => {
    const line = `${wbLine("m1")}\n`;
    await writeFile(file, line);
    const fp1 = await fingerprint(file);
    const r1 = await workbuddyTokenDriver.parse(
      file,
      workbuddyTokenDriver.resumeState(undefined, fp1),
      {},
    );
    const cursor = workbuddyTokenDriver.buildCursor(fp1, r1);
    expect(cursor.seenMessageIds).toEqual(["m1"]);

    // A sibling copy appears in a LATER sync and replays the same request.
    const copy = join(slugDir, "session-copy.jsonl");
    await writeFile(copy, line);
    const ctx = {};
    workbuddyTokenDriver.preload?.({ [file]: cursor }, ctx);
    const fp2 = await fingerprint(copy);
    const r2 = await workbuddyTokenDriver.parse(
      copy,
      workbuddyTokenDriver.resumeState(undefined, fp2),
      ctx,
    );
    expect(r2.deltas).toHaveLength(0);
  });

  it("drops the persisted ring when the file inode changes", async () => {
    const fp = { inode: 2, mtimeMs: 0, size: 100 };
    const stale = {
      inode: 1,
      mtimeMs: 0,
      size: 100,
      offset: 90,
      seenMessageIds: ["old"],
      updatedAt: "",
    };
    const resume = workbuddyTokenDriver.resumeState(stale, fp);
    expect(resume).toMatchObject({ priorSeenMessageIds: [] });
  });

  it("preload lifts only WorkBuddy rings, never a sibling source's seenIds", () => {
    const ctx: SyncContext = {};
    // A Claude cursor exposes `seenIds`; the WorkBuddy driver must key on its
    // own `seenMessageIds` so preload() — which walks EVERY cursor — never
    // pulls another source's ids into the WorkBuddy dedup set.
    const claudeCursor = {
      inode: 1,
      mtimeMs: 0,
      size: 0,
      offset: 0,
      seenIds: ["claude-1"],
      updatedAt: "",
    } as unknown as FileCursorBase;
    workbuddyTokenDriver.preload?.({ "/x/claude.jsonl": claudeCursor }, ctx);
    expect(ctx.seenWorkbuddyMessageIds?.size ?? 0).toBe(0);
  });

  it("declares needsReplay=true for a legacy cursor (no seenMessageIds field)", () => {
    // Upgrade path: an existing install has ByteOffsetCursor-shaped entries
    // in cursors.json with no `seenMessageIds` field. Rescanning that file
    // inside incremental mode would double-count into the SUM'd queue. The
    // driver flags this via needsReplay(); the orchestrator then wipes
    // cursors and restarts as a full scan (overwrite branch).
    const legacyCursor = {
      inode: 42,
      mtimeMs: 1709827200000,
      size: 200,
      offset: 200,
      updatedAt: "2026-06-01T00:00:00Z",
      // no seenMessageIds — legacy shape
    } as unknown as WorkbuddyCursor;
    expect(workbuddyTokenDriver.needsReplay).toBeDefined();
    expect(workbuddyTokenDriver.needsReplay!(legacyCursor)).toBe(true);

    // shouldSkip / resumeState treat a legacy cursor like any other cursor;
    // the replay decision is the orchestrator's, not theirs.
    const fp: FileFingerprint = { inode: 42, mtimeMs: 1709827200000, size: 200 };
    expect(workbuddyTokenDriver.shouldSkip(legacyCursor, fp)).toBe(true);
  });

  it("does not flag modern or missing cursors as needsReplay", () => {
    expect(workbuddyTokenDriver.needsReplay!(undefined)).toBe(false);
    const modern: WorkbuddyCursor = {
      inode: 1,
      mtimeMs: 1,
      size: 1,
      offset: 1,
      seenMessageIds: [],
      updatedAt: "2026-06-01T00:00:00Z",
    };
    expect(workbuddyTokenDriver.needsReplay!(modern)).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { workbuddySessionDriver } from "../../../drivers/session/workbuddy-session-driver.js";
import type { FileFingerprint } from "../../../drivers/types.js";

const T0 = 1757491200000;

function record(over: Record<string, unknown>): string {
  return JSON.stringify({ sessionId: "s1", cwd: "/tmp/wb", timestamp: T0, ...over });
}

async function fingerprint(path: string): Promise<FileFingerprint> {
  const st = await stat(path);
  return {
    inode: (st as unknown as { ino: number }).inode,
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
}

describe("workbuddySessionDriver", () => {
  let root: string;
  let slugDir: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pew-workbuddy-session-drv-"));
    slugDir = join(root, "projects", "Users-someone-WorkBuddy-2026-09-10");
    await mkdir(slugDir, { recursive: true });
    file = join(slugDir, "s1.jsonl");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers session files and returns snapshots", async () => {
    await writeFile(file, `${record({ type: "message", role: "user" })}\n`);

    const files = await workbuddySessionDriver.discover({ workbuddyDir: root });
    expect(files).toEqual([file]);

    const snapshots = await workbuddySessionDriver.parse(file);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.sessionKey).toBe("workbuddy:s1");
  });

  it("returns empty discovery without a directory option", async () => {
    expect(await workbuddySessionDriver.discover({})).toEqual([]);
  });

  it("skips unchanged files via the mtime+size dual check", async () => {
    await writeFile(file, `${record({ type: "message", role: "user" })}\n`);
    const fp = await fingerprint(file);
    const cursor = workbuddySessionDriver.buildCursor(fp);
    expect(workbuddySessionDriver.shouldSkip(cursor, fp)).toBe(true);

    const newer = { ...fp, mtimeMs: fp.mtimeMs + 1_000 };
    expect(workbuddySessionDriver.shouldSkip(cursor, newer)).toBe(false);
    expect(workbuddySessionDriver.shouldSkip(undefined, fp)).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneAliasCursors } from "../storage/prune-alias-cursors.js";

interface DummyCursor {
  inode: number;
  size: number;
}

describe("pruneAliasCursors", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-prune-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("removes a cursor whose path is undiscovered but whose inode matches a discovered file", async () => {
    // Set up: one real file plus a symlink pointing at the same inode.
    // The "canonical" path is the discovery target; the symlink path is
    // the stale alias we expect to prune.
    const realDir = join(tempDir, "real");
    const linkDir = join(tempDir, "link");
    await mkdir(realDir, { recursive: true });
    const realPath = join(realDir, "file.jsonl");
    const aliasPath = join(linkDir, "file.jsonl");
    await writeFile(realPath, "{}");
    await symlink(realDir, linkDir);

    const cursors: Record<string, DummyCursor> = {
      [realPath]: { inode: 1, size: 2 },
      [aliasPath]: { inode: 1, size: 2 },
    };
    const knownFilePaths: Record<string, true> = {
      [realPath]: true,
      [aliasPath]: true,
    };
    const result = await pruneAliasCursors(
      cursors,
      new Set([realPath]),
      knownFilePaths,
    );

    expect(result.removed).toBe(1);
    expect(result.cursorFiles[realPath]).toBeDefined();
    expect(result.cursorFiles[aliasPath]).toBeUndefined();
    expect(result.knownFilePaths?.[realPath]).toBe(true);
    expect(result.knownFilePaths?.[aliasPath]).toBeUndefined();
    // Originals are not mutated.
    expect(cursors[aliasPath]).toBeDefined();
    expect(knownFilePaths[aliasPath]).toBe(true);
  });

  it("keeps cursor entries whose path is undiscovered AND whose inode is unknown (mtime-skip optimization)", async () => {
    // Simulates the OpenCode case: a real, valid cursor for a file
    // discovery chose not to surface (because the parent directory's
    // mtime was unchanged). Discovery returns nothing for it; stat()
    // succeeds; but no discovered file shares its inode, so it must
    // be kept.
    const skippedPath = join(tempDir, "skipped.json");
    await writeFile(skippedPath, "{}");

    const cursors: Record<string, DummyCursor> = {
      [skippedPath]: { inode: 0, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set());

    expect(result.removed).toBe(0);
    expect(result.cursorFiles[skippedPath]).toBeDefined();
  });

  it("keeps cursor entries whose path no longer exists on disk", async () => {
    // Simulates a deleted file: stat() fails. We keep the cursor
    // because deletion alone is not enough to prove staleness — the
    // path could come back (unmounted volume, syncthing pause), and
    // dropping the cursor would lose the replay-detection guard.
    const ghostPath = join(tempDir, "ghost.jsonl");
    const cursors: Record<string, DummyCursor> = {
      [ghostPath]: { inode: 999, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set());

    expect(result.removed).toBe(0);
    expect(result.cursorFiles[ghostPath]).toBeDefined();
  });

  it("does not touch a cursor whose path IS in the discovered set", async () => {
    const realPath = join(tempDir, "real.jsonl");
    await writeFile(realPath, "{}");

    const cursors: Record<string, DummyCursor> = {
      [realPath]: { inode: 0, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set([realPath]));

    expect(result.removed).toBe(0);
    expect(result.cursorFiles[realPath]).toBeDefined();
  });

  it("returns 0 when the discovered set is empty", async () => {
    const cursors: Record<string, DummyCursor> = {};
    const result = await pruneAliasCursors(cursors, new Set());
    expect(result.removed).toBe(0);
    expect(Object.keys(result.cursorFiles)).toHaveLength(0);
  });

  it("handles a stat-failure on a discovered path gracefully", async () => {
    // Discovery returned a path that vanished between discover() and
    // prune (race window). Its inode never enters liveInodes, so it
    // can't accidentally evict cursors. The cursor for that path,
    // being itself in `discovered`, is always kept by rule (a).
    const ghostDiscovered = join(tempDir, "ghost-discovered.jsonl");
    const realPath = join(tempDir, "real.jsonl");
    await writeFile(realPath, "{}");

    const cursors: Record<string, DummyCursor> = {
      [ghostDiscovered]: { inode: 1, size: 0 },
      [realPath]: { inode: 2, size: 0 },
    };
    const result = await pruneAliasCursors(
      cursors,
      new Set([ghostDiscovered, realPath]),
    );

    expect(result.removed).toBe(0);
    expect(result.cursorFiles[ghostDiscovered]).toBeDefined();
    expect(result.cursorFiles[realPath]).toBeDefined();
  });
});

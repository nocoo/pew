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

  it("removes a cursor whose path is undiscovered but whose inode matches a discovered file (alias)", async () => {
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

    expect(result.removedAlias).toBe(1);
    expect(result.removedMissing).toBe(0);
    expect(result.cursorFiles[realPath]).toBeDefined();
    expect(result.cursorFiles[aliasPath]).toBeUndefined();
    expect(result.knownFilePaths?.[realPath]).toBe(true);
    expect(result.knownFilePaths?.[aliasPath]).toBeUndefined();
    // Originals are not mutated.
    expect(cursors[aliasPath]).toBeDefined();
    expect(knownFilePaths[aliasPath]).toBe(true);
  });

  it("removes a cursor whose path no longer exists on disk (missing)", async () => {
    // PR #152's deleted-file bloat case: heavy users accumulate hundreds
    // of thousands of cursors for rotated/deleted files. Each sync's
    // stat() identifies them and they get evicted.
    const ghostPath = join(tempDir, "ghost.jsonl");
    const knownFilePaths: Record<string, true> = { [ghostPath]: true };
    const cursors: Record<string, DummyCursor> = {
      [ghostPath]: { inode: 999, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set(), knownFilePaths);

    expect(result.removedAlias).toBe(0);
    expect(result.removedMissing).toBe(1);
    expect(result.cursorFiles[ghostPath]).toBeUndefined();
    expect(result.knownFilePaths?.[ghostPath]).toBeUndefined();
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

    expect(result.removedAlias).toBe(0);
    expect(result.removedMissing).toBe(0);
    expect(result.cursorFiles[skippedPath]).toBeDefined();
  });

  it("does not touch a cursor whose path IS in the discovered set", async () => {
    const realPath = join(tempDir, "real.jsonl");
    await writeFile(realPath, "{}");

    const cursors: Record<string, DummyCursor> = {
      [realPath]: { inode: 0, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set([realPath]));

    expect(result.removedAlias).toBe(0);
    expect(result.removedMissing).toBe(0);
    expect(result.cursorFiles[realPath]).toBeDefined();
  });

  it("returns 0 when the discovered set is empty and no cursors exist", async () => {
    const cursors: Record<string, DummyCursor> = {};
    const result = await pruneAliasCursors(cursors, new Set());
    expect(result.removedAlias).toBe(0);
    expect(result.removedMissing).toBe(0);
    expect(Object.keys(result.cursorFiles)).toHaveLength(0);
  });

  it("handles a stat-failure on a discovered path gracefully", async () => {
    // Discovery returned a path that vanished between discover() and
    // prune (race window). Its inode never enters liveInodes, so it
    // can't accidentally evict cursors via the alias branch. The cursor
    // for that path, being itself in `discovered`, is kept by the
    // in-discovery rule (not subject to either alias or missing prune).
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

    expect(result.removedAlias).toBe(0);
    expect(result.removedMissing).toBe(0);
    expect(result.cursorFiles[ghostDiscovered]).toBeDefined();
    expect(result.cursorFiles[realPath]).toBeDefined();
  });

  it("attributes alias removal correctly when the same physical file is referenced by both a discovered path and a missing path", async () => {
    // Edge case: alias takes precedence over missing when the path
    // stats successfully (so it could only fall into the alias bucket).
    // This test exists mostly to nail down the classification logic.
    const realDir = join(tempDir, "real");
    const aliasDir = join(tempDir, "link");
    await mkdir(realDir, { recursive: true });
    const realPath = join(realDir, "file.jsonl");
    const aliasPath = join(aliasDir, "file.jsonl");
    const ghostPath = join(tempDir, "ghost.jsonl");
    await writeFile(realPath, "{}");
    await symlink(realDir, aliasDir);

    const cursors: Record<string, DummyCursor> = {
      [realPath]: { inode: 1, size: 0 },
      [aliasPath]: { inode: 1, size: 0 },
      [ghostPath]: { inode: 2, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set([realPath]));

    expect(result.removedAlias).toBe(1);
    expect(result.removedMissing).toBe(1);
    expect(result.cursorFiles[realPath]).toBeDefined();
    expect(result.cursorFiles[aliasPath]).toBeUndefined();
    expect(result.cursorFiles[ghostPath]).toBeUndefined();
  });

  it("does not stat() cursors whose path falls under a protected prefix (mtime-skip respect)", async () => {
    // This is the OpenCode case: the driver intentionally did not enter
    // a session dir this run because its mtime was unchanged. The
    // orchestrator hands those dir paths over as protectedPrefixes, and
    // prune must not stat() any cursor below them. We assert this with
    // BOTH a fake path that would otherwise be classified missing AND
    // a real path that would otherwise be classified alias — neither
    // should be touched.
    const sessionDir = join(tempDir, "opencode", "message", "ses_skipped");
    await mkdir(sessionDir, { recursive: true });
    const realProtected = join(sessionDir, "msg_001.json");
    await writeFile(realProtected, "{}");

    // A separate symlink alias of the same inode that lives under the
    // protected dir. If the implementation ignored protectedPrefixes,
    // this would be classified as an alias and dropped.
    const aliasUnderProtected = join(sessionDir, "msg_001_alias.json");
    await symlink(realProtected, aliasUnderProtected);

    const ghostUnderProtected = join(sessionDir, "msg_deleted.json");

    const cursors: Record<string, DummyCursor> = {
      [realProtected]: { inode: 1, size: 0 },
      [aliasUnderProtected]: { inode: 1, size: 0 },
      [ghostUnderProtected]: { inode: 2, size: 0 },
    };
    // Discovery returns nothing (the dir was skipped).
    const result = await pruneAliasCursors(cursors, new Set(), undefined, {
      protectedPrefixes: [sessionDir],
    });

    expect(result.removedAlias).toBe(0);
    expect(result.removedMissing).toBe(0);
    expect(result.protected).toBe(3);
    expect(result.cursorFiles[realProtected]).toBeDefined();
    expect(result.cursorFiles[aliasUnderProtected]).toBeDefined();
    expect(result.cursorFiles[ghostUnderProtected]).toBeDefined();
  });

  it("treats protectedPrefixes as directory boundaries (no false-positive prefix match)", async () => {
    // /foo/bar must NOT protect /foo/barbaz/file.
    const cursors: Record<string, DummyCursor> = {
      [join(tempDir, "foo/barbaz/file.json")]: { inode: 1, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set(), undefined, {
      protectedPrefixes: [join(tempDir, "foo/bar")],
    });
    expect(result.protected).toBe(0);
    // The path doesn't exist on disk so it's classified missing — the
    // point is that protectedPrefixes did NOT exempt it.
    expect(result.removedMissing).toBe(1);
  });

  it("protects cursor paths that use the Windows separator under a forward-slash prefix", async () => {
    // Cross-platform regression: on Windows the orchestrator threads
    // backslash paths through unchanged. If the prefix uses "/" but
    // the cursor key uses "\\", the boundary probe must still match.
    const winCursor = "C:\\Users\\me\\.local\\opencode\\message\\ses_1\\msg.json";
    const cursors: Record<string, DummyCursor> = {
      [winCursor]: { inode: 1, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set(), undefined, {
      protectedPrefixes: ["C:\\Users\\me\\.local\\opencode\\message\\ses_1"],
    });
    expect(result.protected).toBe(1);
    expect(result.removedMissing).toBe(0);
    expect(result.cursorFiles[winCursor]).toBeDefined();
  });

  it("normalizes prefixes that already end with a trailing separator", async () => {
    // Callers may pass "/foo/bar/" or "/foo/bar\\" — both must collapse
    // to the same bare-dir form so probing adds exactly one separator.
    const fakePath = join(tempDir, "foo/bar/inside.json");
    const cursors: Record<string, DummyCursor> = {
      [fakePath]: { inode: 1, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set(), undefined, {
      protectedPrefixes: [join(tempDir, "foo/bar") + "/"],
    });
    expect(result.protected).toBe(1);
    expect(result.cursorFiles[fakePath]).toBeDefined();
  });

  it("respects directory boundaries when both sides use the Windows separator", async () => {
    // Sibling-name false-positive on Windows: C:\\a\\bar must NOT
    // protect C:\\a\\barbaz\\file. Same rule as the POSIX boundary
    // test above; the regression-class is identical.
    const cursors: Record<string, DummyCursor> = {
      ["C:\\a\\barbaz\\file.json"]: { inode: 1, size: 0 },
    };
    const result = await pruneAliasCursors(cursors, new Set(), undefined, {
      protectedPrefixes: ["C:\\a\\bar"],
    });
    expect(result.protected).toBe(0);
    expect(result.removedMissing).toBe(1);
  });

  it("evicts a known-only stale entry that has no matching cursors.files row", async () => {
    // Reachable failure mode: a path slipped into knownFilePaths via
    // the discover-time merge but never received a cursor (file vanished
    // between discover and parse, or the parser threw). Without iterating
    // the knownFilePaths key set, the prune pass would leave the entry
    // behind forever — bloating the map and, on a future reappearance,
    // tricking sync.ts's cursor-loss detection into a full rescan.
    const ghostPath = join(tempDir, "vanished/session.jsonl");
    const cursors: Record<string, DummyCursor> = {};
    const knownFilePaths: Record<string, true> = { [ghostPath]: true };
    const result = await pruneAliasCursors(cursors, new Set(), knownFilePaths);

    expect(result.removedAlias).toBe(0);
    expect(result.removedMissing).toBe(1);
    expect(result.knownFilePaths?.[ghostPath]).toBeUndefined();
  });

  it("evicts a known-only alias entry where cursors.files has no row", async () => {
    // Same mechanism, alias branch: a path that resolves (via symlink)
    // to an inode already covered by a discovered file but where the
    // cursor write was skipped. The entry in knownFilePaths must still
    // be evicted so a later sync doesn't carry the dead key.
    const realDir = join(tempDir, "real");
    const linkDir = join(tempDir, "link");
    await mkdir(realDir, { recursive: true });
    const realPath = join(realDir, "file.jsonl");
    await writeFile(realPath, "{}");
    await symlink(realDir, linkDir);
    const aliasPath = join(linkDir, "file.jsonl");

    const cursors: Record<string, DummyCursor> = {};
    const knownFilePaths: Record<string, true> = { [aliasPath]: true };
    const result = await pruneAliasCursors(
      cursors,
      new Set([realPath]),
      knownFilePaths,
    );

    expect(result.removedAlias).toBe(1);
    expect(result.removedMissing).toBe(0);
    expect(result.knownFilePaths?.[aliasPath]).toBeUndefined();
  });

  it("leaves a known-only entry alone when its path falls under a protected prefix", async () => {
    // Known-only entries inside an OpenCode mtime-skipped dir must
    // still respect the protectedPrefixes exemption, otherwise we'd
    // turn known-only enumeration into the same 66K-file stat storm
    // the prefix protection exists to prevent.
    const ocDir = join(tempDir, "opencode", "ses_skip");
    await mkdir(ocDir, { recursive: true });
    const insideProtected = join(ocDir, "msg_unwritten.json");
    const cursors: Record<string, DummyCursor> = {};
    const knownFilePaths: Record<string, true> = { [insideProtected]: true };
    const result = await pruneAliasCursors(cursors, new Set(), knownFilePaths, {
      protectedPrefixes: [ocDir],
    });

    expect(result.protected).toBe(1);
    expect(result.removedMissing).toBe(0);
    expect(result.knownFilePaths?.[insideProtected]).toBe(true);
  });
});

import { stat } from "node:fs/promises";

/**
 * Returned by {@link pruneAliasCursors} alongside the prune result so callers
 * can replace both maps in lockstep.
 */
export interface PruneAliasResult<TCursor> {
  /** New cursor map with stale alias entries removed. */
  cursorFiles: Record<string, TCursor>;
  /** New knownFilePaths map with the same entries removed, or undefined if not supplied. */
  knownFilePaths?: Record<string, true>;
  /** Number of entries removed. Informational. */
  removed: number;
}

/**
 * Drop cursor entries that refer to the same physical inode as a path
 * actually surfaced by this run's discovery, but live under a different
 * filesystem path (an "alias"). The canonical example is the Multica
 * codex-home/sessions/ symlink: before #154's dedup, the same rollout
 * file was tracked under N different paths.
 *
 * The rule is intentionally narrow — a cursor is removed ONLY if:
 *   (a) its path is NOT in this run's discovery, AND
 *   (b) stat() of that path succeeds, AND
 *   (c) the resulting dev:ino matches a dev:ino reachable from the
 *       discovered files.
 *
 * Conditions a+b+c together prove "there's a canonical replacement still
 * tracked" — only then is the dropped cursor truly unreachable.
 *
 * Why we don't simply rebuild from `discoveredFiles`:
 *   - OpenCode JSON discovery skips directories whose mtime hasn't
 *     changed (perf optimization). Those files are *valid* cursors but
 *     are absent from `discoveredFiles`. A naive rebuild would silently
 *     drop them, and the next message added to such a directory would
 *     replay the file from scratch and double-count tokens via the
 *     incremental SUM path.
 *   - A file we can't stat (deleted, unmounted volume) is kept: dropping
 *     would only be a noop on size, and keeping preserves the file-cursor
 *     entry for replay detection if the file returns.
 *
 * The function is pure with respect to its inputs (no mutation); callers
 * must reassign the returned maps.
 */
export async function pruneAliasCursors<TCursor>(
  cursorFiles: Readonly<Record<string, TCursor>>,
  discoveredFiles: ReadonlySet<string>,
  knownFilePaths?: Readonly<Record<string, true>>,
): Promise<PruneAliasResult<TCursor>> {
  // Build the set of inodes reachable through paths discovery actually
  // returned this run. These are the inodes we have a canonical alias for.
  const liveInodes = new Set<string>();
  for (const fp of discoveredFiles) {
    const st = await stat(fp).catch(() => null);
    if (st) liveInodes.add(`${st.dev}:${st.ino}`);
  }

  const aliasPaths = new Set<string>();
  for (const path of Object.keys(cursorFiles)) {
    if (discoveredFiles.has(path)) continue;
    const st = await stat(path).catch(() => null);
    if (!st) continue;
    if (!liveInodes.has(`${st.dev}:${st.ino}`)) continue;
    aliasPaths.add(path);
  }

  const nextCursors: Record<string, TCursor> = {};
  for (const [path, cursor] of Object.entries(cursorFiles)) {
    if (!aliasPaths.has(path)) nextCursors[path] = cursor;
  }

  let nextKnown: Record<string, true> | undefined;
  if (knownFilePaths) {
    nextKnown = {};
    for (const [path, value] of Object.entries(knownFilePaths)) {
      if (!aliasPaths.has(path)) nextKnown[path] = value;
    }
  }

  return {
    cursorFiles: nextCursors,
    knownFilePaths: nextKnown,
    removed: aliasPaths.size,
  };
}

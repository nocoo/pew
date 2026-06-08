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
  /** Number of entries removed because their inode matched a discovered file. */
  removedAlias: number;
  /** Number of entries removed because the path no longer exists on disk. */
  removedMissing: number;
  /**
   * Number of entries the caller exempted from evaluation via `protectedPrefixes`.
   * Informational; these entries are kept untouched.
   */
  protected: number;
}

/**
 * Options for {@link pruneAliasCursors}.
 */
export interface PruneAliasOptions {
  /**
   * Directory paths whose cursor entries must NOT be considered for
   * prune. A cursor is exempted when its key starts with `<prefix>/`.
   * Use this for sources that intentionally skip evaluating their own
   * files (e.g. OpenCode mtime-skip): without the exemption, prune
   * would stat() every cursor under those dirs every sync and undo
   * the optimization. Order: exempt entries are kept first, then the
   * remaining set is classified into alias / missing / keep.
   */
  protectedPrefixes?: ReadonlyArray<string>;

  /**
   * Optional superset of `discoveredFiles` for the "skip this cursor
   * because the parse loop already revisited it" short-circuit. Defaults
   * to `discoveredFiles` itself. Callers split the two when "discovery
   * surfaced the path" and "the parse loop produced a cursor for the
   * path" are not the same set — for example, the sync orchestrator
   * passes `freshlyParsedPaths` as `discoveredFiles` (drives the
   * liveInodes set used for alias detection) and a larger
   * `inDiscoveryPaths` (also containing paths whose parse threw or
   * whose stat failed mid-flight) so a mid-flight cursor is not
   * accidentally classified missing/alias on the same run that
   * discovered it.
   */
  inDiscoveryPaths?: ReadonlySet<string>;
}

/**
 * Drop cursor entries that are demonstrably unreachable, in two narrow
 * scenarios. The whole point of the function is to keep the keep/drop
 * rule unambiguous so it does not silently break cursor invariants the
 * rest of the sync pipeline depends on.
 *
 * A cursor entry is dropped if EITHER:
 *
 *   (A) **Alias** — its path is not in this run's discovery, stat()
 *       succeeds, AND the resulting dev:ino matches a dev:ino that was
 *       reachable through one of the discovered paths. The canonical
 *       replacement is already tracked, so the alias entry is dead
 *       weight. Example: pre-#154 Multica codex-home/sessions/ symlink
 *       paths that resolve to the same inode as ~/.codex/sessions/.
 *
 *   (B) **Missing** — its path is not in this run's discovery AND
 *       stat() fails (ENOENT, etc.). The file no longer exists on
 *       disk, so its cursor can never be consulted by the file-parse
 *       loop again. Without this, heavy users accumulate hundreds of
 *       thousands of cursors for rotated/deleted files and
 *       cursors.json grows to hundreds of MB, eventually making
 *       `pew sync` hang on JSON.parse.
 *
 * Entries are KEPT when:
 *
 *   - The path IS in this run's discovery (the parse loop will revisit
 *     it and refresh the cursor in place).
 *
 *   - stat() succeeds but no discovered file shares the inode. This is
 *     the OpenCode mtime-skip case for files whose dir we *did* enter
 *     this run (but whose specific file wasn't discovered — rare).
 *
 *   - The path begins with one of `options.protectedPrefixes`. This is
 *     how callers protect entire mtime-skipped directories from being
 *     stat()'d per file: the OpenCode driver lists ~3K session dirs
 *     once, then declares the unchanged ones protected so the prune
 *     pass doesn't fan out to all 66K message files inside them.
 *
 * Trade-off intentionally accepted for (B): a path that temporarily
 * vanishes (unmounted volume, paused syncthing) loses its replay-detection
 * guard. When it returns, the file will be treated as new and SUM'd —
 * a one-cycle over-count for that file, recoverable via `pew reset`. We
 * accept this in exchange for converging cursors.json size on the more
 * common "log rotation / message file deletion" pattern. Inode-change
 * replay detection (cursor && cursor.inode !== fingerprint.inode) is
 * unaffected and still catches the in-place file-replacement case.
 *
 * The function is pure with respect to its inputs (no mutation); callers
 * must reassign the returned maps.
 */
export async function pruneAliasCursors<TCursor>(
  cursorFiles: Readonly<Record<string, TCursor>>,
  discoveredFiles: ReadonlySet<string>,
  knownFilePaths?: Readonly<Record<string, true>>,
  options?: PruneAliasOptions,
): Promise<PruneAliasResult<TCursor>> {
  // Normalize each protected prefix into the bare directory form, then
  // probe candidate cursor paths against BOTH `${prefix}/` and
  // `${prefix}\` so a Windows host whose cursor keys use backslashes is
  // not silently unprotected. node:path joins use the platform separator
  // and the orchestrator threads paths through unchanged, so a single-
  // separator check here would re-introduce the OpenCode 66K-file stat
  // storm on Windows. The dual-suffix probe is also safe on POSIX where
  // `\` is a legal filename character — it just never matches.
  const prefixes = (options?.protectedPrefixes ?? []).map((p) => {
    let trimmed = p;
    while (trimmed.endsWith("/") || trimmed.endsWith("\\")) {
      trimmed = trimmed.slice(0, -1);
    }
    return trimmed;
  });
  const isProtected = (path: string): boolean =>
    prefixes.some((prefix) =>
      path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`),
    );

  // "In-discovery" guards against evicting a cursor that the parse
  // loop already touched this run (whether or not it succeeded). The
  // caller may pass a wider set than `discoveredFiles` itself; default
  // to discoveredFiles for the common case where the two coincide.
  const inDiscovery = options?.inDiscoveryPaths ?? discoveredFiles;

  const liveInodes = new Set<string>();
  for (const fp of discoveredFiles) {
    const st = await stat(fp).catch(() => null);
    if (st) liveInodes.add(`${st.dev}:${st.ino}`);
  }

  const aliasPaths = new Set<string>();
  const missingPaths = new Set<string>();
  let protectedCount = 0;
  // Iterate the union of cursorFiles and knownFilePaths keys so we also
  // catch "known-only" stale entries: paths that made it into
  // knownFilePaths via the discovery merge but whose cursor write was
  // skipped because the file vanished or the parser threw between
  // discover and parse. Leaving them in knownFilePaths bloats the map
  // and, if the path later reappears, triggers a spurious full rescan
  // through the cursor-loss detection branch in sync.ts.
  const candidatePaths = new Set<string>(Object.keys(cursorFiles));
  if (knownFilePaths) {
    for (const path of Object.keys(knownFilePaths)) candidatePaths.add(path);
  }
  for (const path of candidatePaths) {
    if (inDiscovery.has(path)) continue;
    if (isProtected(path)) {
      protectedCount++;
      continue;
    }
    const st = await stat(path).catch(() => null);
    if (!st) {
      missingPaths.add(path);
      continue;
    }
    if (liveInodes.has(`${st.dev}:${st.ino}`)) {
      aliasPaths.add(path);
    }
  }

  const drop = (path: string): boolean => aliasPaths.has(path) || missingPaths.has(path);

  const nextCursors: Record<string, TCursor> = {};
  for (const [path, cursor] of Object.entries(cursorFiles)) {
    if (!drop(path)) nextCursors[path] = cursor;
  }

  let nextKnown: Record<string, true> | undefined;
  if (knownFilePaths) {
    nextKnown = {};
    for (const [path, value] of Object.entries(knownFilePaths)) {
      if (!drop(path)) nextKnown[path] = value;
    }
  }

  return {
    cursorFiles: nextCursors,
    knownFilePaths: nextKnown,
    removedAlias: aliasPaths.size,
    removedMissing: missingPaths.size,
    protected: protectedCount,
  };
}

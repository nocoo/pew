/**
 * WorkBuddy file token driver.
 *
 * Strategy: Byte-offset JSONL streaming of
 * `~/.workbuddy/projects/<slug>/<sessionId>.jsonl` (and the international
 * `~/.workbuddy-ai` root).
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseWorkbuddyFile({ filePath, startOffset, seenMessageIds })
 *
 * Dedup is keyed on `providerData.messageId` (see parsers/workbuddy.ts):
 *  - Within one sync, every id counts once across ALL configured roots. The
 *    Set lives on the SyncContext (`seenWorkbuddyMessageIds`) so a session
 *    copied between the domestic and international roots — or duplicated into
 *    a sibling file — is not counted twice.
 *  - Across syncs, the last `SEEN_ID_CAP` emitted ids per file are persisted
 *    on the cursor (`WorkbuddyCursor.seenMessageIds`). preload() lifts every
 *    file's ring into the ctx Set before the skip/parse loop, so a file that
 *    fast-skips still contributes its ids; resumeState() carries the same
 *    ring inline as a defense-in-depth seed when parse() is invoked
 *    standalone (tests, ad-hoc callers).
 *  - buildCursor() folds new emissions back into the per-file ring, keeping
 *    the most-recent tail; the ring is dropped when the file inode changes.
 *
 * Upgrade: cursors written before the ring existed are ByteOffsetCursor-shaped
 * (they have `offset` but no `seenMessageIds` field). needsReplay() flags them
 * so the orchestrator restarts the whole sync as a full scan (overwrite queue,
 * not append) — a per-file rescan inside incremental mode would double the
 * queue value for that file's historical buckets.
 */

import type { WorkbuddyCursor, FileCursorBase } from "@pew/core";
import { discoverWorkbuddyFilesFromRoots } from "../../discovery/sources.js";
import { parseWorkbuddyFile } from "../../parsers/workbuddy.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type {
  FileTokenDriver,
  DiscoverOpts,
  SyncContext,
  FileFingerprint,
  ResumeState,
  TokenParseResult,
  WorkbuddyResumeState,
} from "../types.js";

/**
 * Bound on `WorkbuddyCursor.seenMessageIds`. A duplicated session replays the whole
 * parent history, so the ring must cover a full session's requests, not just a
 * few dozen tail lines; 2000 keeps a long session bounded without letting the
 * cursor file grow without limit.
 */
const SEEN_ID_CAP = 2000;

/** Extended parse result carrying endOffset + emitted ids for cursor build */
interface WorkbuddyParseResult extends TokenParseResult {
  endOffset: number;
  emittedMessageIds: string[];
}

export const workbuddyTokenDriver: FileTokenDriver<WorkbuddyCursor> = {
  kind: "file",
  source: "workbuddy",

  async discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]> {
    // Bind the per-context dedup Set here so parse() can consume it.
    if (!ctx.seenWorkbuddyMessageIds) ctx.seenWorkbuddyMessageIds = new Set<string>();
    if (!opts.workbuddyDirs?.length) return [];
    return discoverWorkbuddyFilesFromRoots(opts.workbuddyDirs);
  },

  /**
   * Lift every persisted `seenMessageIds` ring into the per-run dedup Set before any
   * file is fast-skipped — otherwise an unchanged file never reaches parse()
   * and its ids never enter the ctx Set, leaving a sibling copy free to
   * double-count them.
   */
  preload(cursors: Record<string, FileCursorBase>, ctx: SyncContext): void {
    if (!ctx.seenWorkbuddyMessageIds) ctx.seenWorkbuddyMessageIds = new Set<string>();
    for (const cursor of Object.values(cursors)) {
      const ids = (cursor as Partial<WorkbuddyCursor>).seenMessageIds;
      if (!ids) continue;
      for (const id of ids) ctx.seenWorkbuddyMessageIds.add(id);
    }
  },

  needsReplay(cursor: WorkbuddyCursor | undefined): boolean {
    return isLegacyCursor(cursor);
  },

  shouldSkip(
    cursor: WorkbuddyCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: WorkbuddyCursor | undefined, fingerprint: FileFingerprint): WorkbuddyResumeState {
    const sameInode = cursor && cursor.inode === fingerprint.inode;
    return {
      kind: "workbuddy",
      startOffset: sameInode ? (cursor.offset ?? 0) : 0,
      // Only trust seenMessageIds when the inode matches; a rotated file's ids
      // are meaningless (and often collide with fresh ids in the new file).
      priorSeenMessageIds: sameInode ? (cursor.seenMessageIds ?? []) : [],
    };
  },

  async parse(
    filePath: string,
    resume: ResumeState,
    ctx: SyncContext,
  ): Promise<WorkbuddyParseResult> {
    const r = resume as WorkbuddyResumeState;

    // Seed the per-context dedup Set with ids from this file's cursor ring.
    // Ensures an appended duplicate line is suppressed on the incremental
    // read (the parser only sees bytes after r.startOffset — the earlier copy
    // that produced this id is not in the byte range being parsed).
    const seen = ctx.seenWorkbuddyMessageIds ?? new Set<string>();
    for (const id of r.priorSeenMessageIds) seen.add(id);
    ctx.seenWorkbuddyMessageIds = seen;

    const result = await parseWorkbuddyFile({
      ...(ctx.collectAccounting ? { includeAccounting: true } : {}),
      filePath,
      startOffset: r.startOffset,
      endBound: r.endBound,
      seenMessageIds: seen,
    });
    return {
      deltas: result.deltas,
      endOffset: result.endOffset,
      emittedMessageIds: result.emittedMessageIds,
    };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    prev?: WorkbuddyCursor,
  ): WorkbuddyCursor {
    const r = result as WorkbuddyParseResult;
    // Fold new emissions into the ring. Prior tail comes first, then this
    // parse's emissions, then trim to the cap keeping the most-recent tail.
    // On inode change we drop the prior ring entirely (matches resumeState).
    const sameInode = prev && prev.inode === fingerprint.inode;
    const priorRing = sameInode ? (prev.seenMessageIds ?? []) : [];
    const merged = mergeBoundedIds(priorRing, r.emittedMessageIds, SEEN_ID_CAP);
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      seenMessageIds: merged,
      updatedAt: new Date().toISOString(),
    };
  },
};

/**
 * Merge two ordered id lists (most-recent last), dedup while preserving
 * insertion order of the LATEST occurrence, then trim to keep only the last
 * `cap` entries.
 */
function mergeBoundedIds(prior: string[], next: string[], cap: number): string[] {
  const combined = [...prior, ...next];
  const seen = new Set<string>();
  const dedupedReversed: string[] = [];
  for (let i = combined.length - 1; i >= 0; i--) {
    const id = combined[i];
    if (seen.has(id)) continue;
    seen.add(id);
    dedupedReversed.push(id);
    if (dedupedReversed.length >= cap) break;
  }
  return dedupedReversed.reverse();
}

/**
 * Detect a legacy cursor written before the dedup ring existed. Such cursors
 * are ByteOffsetCursor-shaped: they have `offset` but the `seenMessageIds` field is
 * entirely absent (not just an empty array). A modern cursor with no recent
 * ids has `seenMessageIds: []`.
 */
function isLegacyCursor(cursor: WorkbuddyCursor | undefined): boolean {
  if (!cursor) return false;
  return !Object.hasOwn(cursor, "seenMessageIds");
}

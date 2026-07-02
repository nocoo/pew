/**
 * Claude Code file token driver.
 *
 * Strategy: Byte-offset JSONL streaming.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseClaudeFile({ filePath, startOffset, seenMessageIds })
 *
 * Dedup:
 * - Within a single sync context each `message.id` counts once. The Set
 *   lives on the SyncContext (`seenClaudeMessageIds`) so concurrent syncs
 *   never share state.
 * - Across syncs, the last `SEEN_ID_CAP` emitted ids per file are persisted
 *   on the cursor (`ClaudeCursor.seenIds`). resumeState() seeds them into
 *   the ctx Set so an appended duplicate line — Claude Code rewrites the
 *   same assistant message on streaming retries and subagent hand-offs —
 *   is suppressed on the next incremental sync. buildCursor() folds the
 *   new emissions into the ring, keeping the most-recent tail (that's
 *   where retry duplicates cluster on real installs).
 */

import type { ClaudeCursor } from "@pew/core";
import { discoverClaudeFiles } from "../../discovery/sources.js";
import { parseClaudeFile } from "../../parsers/claude.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type {
  FileTokenDriver,
  DiscoverOpts,
  SyncContext,
  FileFingerprint,
  ResumeState,
  TokenParseResult,
  ClaudeResumeState,
} from "../types.js";

/**
 * Bound on `ClaudeCursor.seenIds`. Real-world duplicate clusters observed
 * on a live install span at most a few dozen lines (streaming retries,
 * subagent hand-offs, resume-after-crash). 200 gives a comfortable margin
 * without letting the cursor file grow without bound on long sessions.
 */
const SEEN_ID_CAP = 200;

/** Extended parse result carrying endOffset + emitted ids for cursor build */
interface ClaudeParseResult extends TokenParseResult {
  endOffset: number;
  emittedIds: string[];
}

export const claudeTokenDriver: FileTokenDriver<ClaudeCursor> = {
  kind: "file",
  source: "claude-code",

  async discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]> {
    // Bind the per-context dedup Set here so parse() can consume it.
    if (!ctx.seenClaudeMessageIds) ctx.seenClaudeMessageIds = new Set<string>();
    if (!opts.claudeDir) return [];
    return discoverClaudeFiles(opts.claudeDir);
  },

  shouldSkip(cursor: ClaudeCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: ClaudeCursor | undefined, fingerprint: FileFingerprint): ClaudeResumeState {
    const sameInode = cursor && cursor.inode === fingerprint.inode;
    return {
      kind: "claude",
      startOffset: sameInode ? (cursor.offset ?? 0) : 0,
      // Only trust seenIds when the inode matches; a rotated file's ids
      // are meaningless (and often collide with fresh ids in the new file).
      priorSeenIds: sameInode ? (cursor.seenIds ?? []) : [],
    };
  },

  async parse(filePath: string, resume: ResumeState, ctx: SyncContext): Promise<ClaudeParseResult> {
    const r = resume as ClaudeResumeState;

    // Seed the per-context dedup Set with ids from the last sync's cursor.
    // Ensures an appended duplicate line is suppressed on the incremental
    // read (parser only sees bytes after r.startOffset — the earlier copy
    // that produced this id is not in the byte range being parsed).
    const seen = ctx.seenClaudeMessageIds ?? new Set<string>();
    for (const id of r.priorSeenIds) seen.add(id);
    ctx.seenClaudeMessageIds = seen;

    const result = await parseClaudeFile({
      filePath,
      startOffset: r.startOffset,
      seenMessageIds: seen,
    });
    return {
      deltas: result.deltas,
      endOffset: result.endOffset,
      emittedIds: result.emittedIds,
    };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    prev?: ClaudeCursor,
  ): ClaudeCursor {
    const r = result as ClaudeParseResult;
    // Fold new emissions into the ring. Prior tail comes first, then this
    // parse's emissions, then trim to the cap keeping the most-recent tail.
    // On inode change we drop the prior ring entirely (matches resumeState).
    const sameInode = prev && prev.inode === fingerprint.inode;
    const priorRing = sameInode ? (prev.seenIds ?? []) : [];
    const merged = mergeBounded(priorRing, r.emittedIds, SEEN_ID_CAP);
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      seenIds: merged,
      updatedAt: new Date().toISOString(),
    };
  },
};

/**
 * Merge two ordered id lists (most-recent last), dedup while preserving
 * insertion order of the LATEST occurrence, then trim to keep only the
 * last `cap` entries. Guarantees the most-recent tail survives so future
 * duplicates clustered near the end of the stream get caught.
 */
function mergeBounded(prior: string[], next: string[], cap: number): string[] {
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

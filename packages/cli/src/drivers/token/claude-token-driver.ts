/**
 * Claude Code file token driver.
 *
 * Strategy: Byte-offset JSONL streaming.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseClaudeFile({ filePath, startOffset, seenMessageIds })
 *
 * Dedup: within a single sync context, each `message.id` counts once.
 * The Set lives on the SyncContext (as `seenClaudeMessageIds`) so that
 * concurrent syncs (should any ever exist) keep their state isolated,
 * and so the Set is dropped as soon as the context is dropped.
 */

import type { ByteOffsetCursor } from "@pew/core";
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
  ByteOffsetResumeState,
} from "../types.js";

/** Extended parse result carrying endOffset for cursor construction */
interface ClaudeParseResult extends TokenParseResult {
  endOffset: number;
}

export const claudeTokenDriver: FileTokenDriver<ByteOffsetCursor> = {
  kind: "file",
  source: "claude-code",

  async discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]> {
    // Bind the per-context dedup Set here so parse() can consume it.
    if (!ctx.seenClaudeMessageIds) ctx.seenClaudeMessageIds = new Set<string>();
    if (!opts.claudeDir) return [];
    return discoverClaudeFiles(opts.claudeDir);
  },

  shouldSkip(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): ByteOffsetResumeState {
    const startOffset =
      cursor && cursor.inode === fingerprint.inode ? (cursor.offset ?? 0) : 0;
    return { kind: "byte-offset", startOffset };
  },

  async parse(filePath: string, resume: ResumeState, ctx: SyncContext): Promise<ClaudeParseResult> {
    const r = resume as ByteOffsetResumeState;
    const result = await parseClaudeFile({
      filePath,
      startOffset: r.startOffset,
      seenMessageIds: ctx.seenClaudeMessageIds,
    });
    return { deltas: result.deltas, endOffset: result.endOffset };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: ByteOffsetCursor,
  ): ByteOffsetCursor {
    const r = result as ClaudeParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      updatedAt: new Date().toISOString(),
    };
  },
};

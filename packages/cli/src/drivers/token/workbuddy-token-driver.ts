/**
 * WorkBuddy file token driver.
 *
 * Strategy: Byte-offset JSONL streaming of
 * `~/.workbuddy/projects/<slug>/<sessionId>.jsonl`.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseWorkbuddyFile({ filePath, startOffset })
 *
 * Dedup is per-parse, keyed on `providerData.messageId` (see parsers/workbuddy.ts).
 * Unlike Claude Code, WorkBuddy appends each request's usage exactly once and
 * never rewrites it, so no cross-sync id ring is persisted.
 */

import type { ByteOffsetCursor } from "@pew/core";
import { discoverWorkbuddyFiles } from "../../discovery/sources.js";
import { parseWorkbuddyFile } from "../../parsers/workbuddy.js";
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
interface WorkbuddyParseResult extends TokenParseResult {
  endOffset: number;
}

export const workbuddyTokenDriver: FileTokenDriver<ByteOffsetCursor> = {
  kind: "file",
  source: "workbuddy",

  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.workbuddyDir) return [];
    return discoverWorkbuddyFiles(opts.workbuddyDir);
  },

  shouldSkip(
    cursor: ByteOffsetCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(
    cursor: ByteOffsetCursor | undefined,
    fingerprint: FileFingerprint,
  ): ByteOffsetResumeState {
    const startOffset =
      cursor && cursor.inode === fingerprint.inode ? (cursor.offset ?? 0) : 0;
    return { kind: "byte-offset", startOffset };
  },

  async parse(
    filePath: string,
    resume: ResumeState,
    ctx: SyncContext,
  ): Promise<WorkbuddyParseResult> {
    const r = resume as ByteOffsetResumeState;
    const result = await parseWorkbuddyFile({
      ...(ctx.collectAccounting ? { includeAccounting: true } : {}),
      filePath,
      startOffset: r.startOffset,
      endBound: r.endBound,
    });
    return { deltas: result.deltas, endOffset: result.endOffset };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
  ): ByteOffsetCursor {
    const r = result as WorkbuddyParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      updatedAt: new Date().toISOString(),
    };
  },
};

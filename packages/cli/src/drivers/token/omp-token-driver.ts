/**
 * Oh My Pi file token driver.
 *
 * omp is a pi fork writing the identical session JSONL schema, so it reuses
 * the pi parser with `source: "omp"`.
 *
 * Strategy: Byte-offset JSONL streaming (same as Claude Code).
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parsePiFile({ filePath, startOffset, source: "omp" })
 */

import type { ByteOffsetCursor } from "@pew/core";
import { discoverOmpFiles } from "../../discovery/sources.js";
import { parsePiFile } from "../../parsers/pi.js";
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
interface OmpParseResult extends TokenParseResult {
  endOffset: number;
}

export const ompTokenDriver: FileTokenDriver<ByteOffsetCursor> = {
  kind: "file",
  source: "omp",

  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.ompSessionsDir) return [];
    return discoverOmpFiles(opts.ompSessionsDir);
  },

  shouldSkip(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): ByteOffsetResumeState {
    const startOffset =
      cursor && cursor.inode === fingerprint.inode ? (cursor.offset ?? 0) : 0;
    return { kind: "byte-offset", startOffset };
  },

  async parse(filePath: string, resume: ResumeState, _ctx: SyncContext): Promise<OmpParseResult> {
    const r = resume as ByteOffsetResumeState;
    const result = await parsePiFile({
      filePath,
      startOffset: r.startOffset,
      endBound: r.endBound,
      source: "omp",
    });
    return { deltas: result.deltas, endOffset: result.endOffset };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: ByteOffsetCursor,
  ): ByteOffsetCursor {
    const r = result as OmpParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      updatedAt: new Date().toISOString(),
    };
  },
};

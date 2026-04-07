/**
 * Pi file token driver.
 *
 * Strategy: Byte-offset JSONL streaming (same as Claude Code).
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parsePiFile({ filePath, startOffset })
 */

import type { ByteOffsetCursor } from "@pew/core";
import { discoverPiFiles } from "../../discovery/sources.js";
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
interface PiParseResult extends TokenParseResult {
  endOffset: number;
}

export const piTokenDriver: FileTokenDriver<ByteOffsetCursor> = {
  kind: "file",
  source: "pi",

  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.piSessionsDir) return [];
    return discoverPiFiles(opts.piSessionsDir);
  },

  shouldSkip(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): ByteOffsetResumeState {
    const startOffset =
      cursor && cursor.inode === fingerprint.inode ? (cursor.offset ?? 0) : 0;
    return { kind: "byte-offset", startOffset };
  },

  async parse(filePath: string, resume: ResumeState): Promise<PiParseResult> {
    const r = resume as ByteOffsetResumeState;
    const result = await parsePiFile({ filePath, startOffset: r.startOffset });
    return { deltas: result.deltas, endOffset: result.endOffset };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: ByteOffsetCursor,
  ): ByteOffsetCursor {
    const r = result as PiParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      updatedAt: new Date().toISOString(),
    };
  },
};

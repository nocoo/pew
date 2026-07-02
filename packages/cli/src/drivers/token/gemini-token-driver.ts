/**
 * Gemini CLI file token driver.
 *
 * Strategy: Array-index JSON parsing with cumulative diff.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseGeminiFile({ filePath, startIndex, lastTotals })
 */

import type { GeminiCursor, TokenDelta } from "@pew/core";
import { discoverGeminiFiles } from "../../discovery/sources.js";
import { parseGeminiFile } from "../../parsers/gemini.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type {
  FileTokenDriver,
  DiscoverOpts,
  SyncContext,
  FileFingerprint,
  ResumeState,
  TokenParseResult,
  ArrayIndexResumeState,
} from "../types.js";

/** Extended parse result carrying Gemini-specific cursor state */
interface GeminiParseResult extends TokenParseResult {
  lastIndex: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
}

export const geminiTokenDriver: FileTokenDriver<GeminiCursor> = {
  kind: "file",
  source: "gemini-cli",

  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.geminiDir) return [];
    return discoverGeminiFiles(opts.geminiDir);
  },

  shouldSkip(cursor: GeminiCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: GeminiCursor | undefined, fingerprint: FileFingerprint): ArrayIndexResumeState {
    const sameFile = cursor && cursor.inode === fingerprint.inode;
    return {
      kind: "array-index",
      startIndex: sameFile ? (cursor.lastIndex ?? -1) : -1,
      lastTotals: sameFile ? (cursor.lastTotals ?? null) : null,
    };
  },

  async parse(filePath: string, resume: ResumeState, _ctx: SyncContext): Promise<GeminiParseResult> {
    const r = resume as ArrayIndexResumeState;
    const result = await parseGeminiFile({
      filePath,
      startIndex: r.startIndex,
      lastTotals: r.lastTotals,
    });
    return {
      deltas: result.deltas,
      lastIndex: result.lastIndex,
      lastTotals: result.lastTotals,
      lastModel: result.lastModel,
    };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: GeminiCursor,
  ): GeminiCursor {
    const r = result as GeminiParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      lastIndex: r.lastIndex,
      lastTotals: r.lastTotals,
      lastModel: r.lastModel,
      updatedAt: new Date().toISOString(),
    };
  },
};

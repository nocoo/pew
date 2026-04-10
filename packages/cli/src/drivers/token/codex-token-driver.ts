/**
 * Codex CLI file token driver.
 *
 * Strategy: Byte-offset JSONL streaming + cumulative diff.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseCodexFile({ filePath, startOffset, lastTotals, lastModel })
 */

import type { CodexCursor, TokenDelta } from "@pew/core";
import { discoverCodexFiles } from "../../discovery/sources.js";
import { parseCodexFile } from "../../parsers/codex.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type {
  FileTokenDriver,
  DiscoverOpts,
  SyncContext,
  FileFingerprint,
  ResumeState,
  TokenParseResult,
  CodexResumeState,
} from "../types.js";

/** Extended parse result carrying Codex-specific cursor state */
interface CodexParseResult extends TokenParseResult {
  endOffset: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
}

export const codexTokenDriver: FileTokenDriver<CodexCursor> = {
  kind: "file",
  source: "codex",

  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.codexSessionsDir) return [];
    return discoverCodexFiles(opts.codexSessionsDir, opts.multicaCodexDirs);
  },

  shouldSkip(cursor: CodexCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: CodexCursor | undefined, fingerprint: FileFingerprint): CodexResumeState {
    const sameFile = cursor && cursor.inode === fingerprint.inode;
    return {
      kind: "codex",
      startOffset: sameFile ? (cursor.offset ?? 0) : 0,
      lastTotals: sameFile ? (cursor.lastTotals ?? null) : null,
      lastModel: sameFile ? (cursor.lastModel ?? null) : null,
    };
  },

  async parse(filePath: string, resume: ResumeState): Promise<CodexParseResult> {
    const r = resume as CodexResumeState;
    const result = await parseCodexFile({
      filePath,
      startOffset: r.startOffset,
      lastTotals: r.lastTotals,
      lastModel: r.lastModel,
    });
    return {
      deltas: result.deltas,
      endOffset: result.endOffset,
      lastTotals: result.lastTotals,
      lastModel: result.lastModel,
    };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: CodexCursor,
  ): CodexCursor {
    const r = result as CodexParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      lastTotals: r.lastTotals,
      lastModel: r.lastModel,
      updatedAt: new Date().toISOString(),
    };
  },
};

/**
 * Grok CLI file token driver.
 *
 * Strategy: Byte-offset JSONL streaming of ~/.grok/logs/unified.jsonl.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Model maps: built from sibling sessions/ dir before parse.
 */

import { dirname, join } from "node:path";
import type { ByteOffsetCursor } from "@pew/core";
import { discoverGrokLogFile } from "../../discovery/sources.js";
import { buildGrokModelMaps, parseGrokLogFile } from "../../parsers/grok.js";
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
interface GrokParseResult extends TokenParseResult {
  endOffset: number;
}

export const grokTokenDriver: FileTokenDriver<ByteOffsetCursor> = {
  kind: "file",
  source: "grok",

  async discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]> {
    if (!opts.grokLogsPath) return [];
    // Stash override so parse() can resolve models without hard-coding layout
    if (opts.grokSessionsDir) {
      ctx.grokSessionsDir = opts.grokSessionsDir;
    }
    return discoverGrokLogFile(opts.grokLogsPath);
  },

  shouldSkip(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): ByteOffsetResumeState {
    const startOffset =
      cursor && cursor.inode === fingerprint.inode ? (cursor.offset ?? 0) : 0;
    return { kind: "byte-offset", startOffset };
  },

  async parse(filePath: string, resume: ResumeState, ctx: SyncContext): Promise<GrokParseResult> {
    const r = resume as ByteOffsetResumeState;
    // Prefer explicit override (DiscoverOpts.grokSessionsDir via ctx);
    // fall back to default layout: logs/unified.jsonl → sibling sessions/
    const sessionsDir =
      ctx.grokSessionsDir ?? join(dirname(filePath), "..", "sessions");
    const maps = await buildGrokModelMaps(sessionsDir);
    const result = await parseGrokLogFile({
      filePath,
      startOffset: r.startOffset,
      sidTurnTimeline: maps.sidTurnTimeline,
      sidPrimaryModel: maps.sidPrimaryModel,
    });
    return { deltas: result.deltas, endOffset: result.endOffset };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: ByteOffsetCursor,
  ): ByteOffsetCursor {
    const r = result as GrokParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      updatedAt: new Date().toISOString(),
    };
  },
};

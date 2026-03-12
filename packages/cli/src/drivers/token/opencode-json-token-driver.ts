/**
 * OpenCode JSON file token driver.
 *
 * Strategy: Cumulative diff per-file JSON parsing.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size) — triple-check.
 * Parser: parseOpenCodeFile({ filePath, lastTotals })
 *
 * Special behaviors:
 * - discover() reads/writes ctx.dirMtimes for directory-level skip optimization.
 * - afterAll() deposits messageKeys into ctx for cross-source dedup with SQLite.
 */

import type { OpenCodeCursor, FileCursorBase, TokenDelta } from "@pew/core";
import { discoverOpenCodeFiles } from "../../discovery/sources.js";
import { parseOpenCodeFile } from "../../parsers/opencode.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type {
  FileTokenDriver,
  DiscoverOpts,
  SyncContext,
  FileFingerprint,
  ResumeState,
  TokenParseResult,
  OpenCodeJsonResumeState,
} from "../types.js";

/** Extended parse result carrying OpenCode-specific cursor state */
interface OpenCodeJsonParseResult extends TokenParseResult {
  messageKey: string | null;
  lastTotals: TokenDelta | null;
}

export const openCodeJsonTokenDriver: FileTokenDriver<OpenCodeCursor> = {
  kind: "file",
  source: "opencode",

  async discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]> {
    if (!opts.openCodeMessageDir) return [];
    const discovery = await discoverOpenCodeFiles(
      opts.openCodeMessageDir,
      ctx.dirMtimes,
    );
    // Store dirMtimes back into context for orchestrator persistence
    ctx.dirMtimes = discovery.dirMtimes;
    return discovery.files;
  },

  shouldSkip(cursor: OpenCodeCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: OpenCodeCursor | undefined, fingerprint: FileFingerprint): OpenCodeJsonResumeState {
    const sameFile = cursor && cursor.inode === fingerprint.inode;
    return {
      kind: "opencode-json",
      lastTotals: sameFile ? (cursor.lastTotals ?? null) : null,
    };
  },

  async parse(filePath: string, resume: ResumeState): Promise<OpenCodeJsonParseResult> {
    const r = resume as OpenCodeJsonResumeState;
    const result = await parseOpenCodeFile({ filePath, lastTotals: r.lastTotals });
    return {
      deltas: result.delta ? [result.delta] : [],
      messageKey: result.messageKey,
      lastTotals: result.lastTotals,
    };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: OpenCodeCursor,
  ): OpenCodeCursor {
    const r = result as OpenCodeJsonParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      lastTotals: r.lastTotals,
      messageKey: r.messageKey,
      updatedAt: new Date().toISOString(),
    };
  },

  afterAll(cursors: Record<string, FileCursorBase>, ctx: SyncContext): void {
    // Deposit messageKeys into context for SQLite dedup
    const keys = new Set<string>();
    for (const cursor of Object.values(cursors)) {
      const oc = cursor as OpenCodeCursor;
      if (oc.messageKey) {
        keys.add(oc.messageKey);
      }
    }
    if (keys.size > 0) {
      ctx.messageKeys = keys;
    }
  },
};

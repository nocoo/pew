/**
 * VSCode Copilot Chat file token driver.
 *
 * Strategy: Byte-offset CRDT JSONL streaming with persistent
 * request-index→metadata mapping for cross-line correlation.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseVscodeCopilotFile({ filePath, startOffset, requestMeta, processedRequestIndices })
 */

import type { VscodeCopilotCursor } from "@pew/core";
import { discoverVscodeCopilotFiles } from "../../discovery/sources.js";
import { parseVscodeCopilotFile, type SkipInfo } from "../../parsers/vscode-copilot.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type {
  FileTokenDriver,
  DiscoverOpts,
  SyncContext,
  FileFingerprint,
  ResumeState,
  TokenParseResult,
  VscodeCopilotResumeState,
} from "../types.js";

/** Extended parse result carrying CRDT state for cursor construction */
interface VscodeCopilotParseResult extends TokenParseResult {
  endOffset: number;
  requestMeta: Record<number, { modelId: string; timestamp: number }>;
  processedRequestIndices: number[];
}

export const vscodeCopilotTokenDriver: FileTokenDriver<VscodeCopilotCursor> = {
  kind: "file",
  source: "vscode-copilot",

  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.vscodeCopilotDirs || opts.vscodeCopilotDirs.length === 0) return [];
    return discoverVscodeCopilotFiles(opts.vscodeCopilotDirs);
  },

  shouldSkip(cursor: VscodeCopilotCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(
    cursor: VscodeCopilotCursor | undefined,
    fingerprint: FileFingerprint,
  ): VscodeCopilotResumeState {
    // If inode changed (file rotated/replaced), start from scratch
    const inodesMatch = cursor && cursor.inode === fingerprint.inode;
    return {
      kind: "vscode-copilot",
      startOffset: inodesMatch ? (cursor.offset ?? 0) : 0,
      requestMeta: inodesMatch ? (cursor.requestMeta ?? {}) : {},
      processedRequestIndices: inodesMatch ? (cursor.processedRequestIndices ?? []) : [],
    };
  },

  async parse(filePath: string, resume: ResumeState): Promise<VscodeCopilotParseResult> {
    const r = resume as VscodeCopilotResumeState;
    const onSkip = (info: SkipInfo) => {
      const ms = info.modelState != null ? ` modelState=${info.modelState}` : "";
      console.debug(`[vscode-copilot] skip request #${info.index}: ${info.reason}${ms} (${filePath})`);
    };
    const result = await parseVscodeCopilotFile({
      filePath,
      startOffset: r.startOffset,
      requestMeta: r.requestMeta,
      processedRequestIndices: r.processedRequestIndices,
      onSkip,
    });
    return {
      deltas: result.deltas,
      endOffset: result.endOffset,
      requestMeta: result.requestMeta,
      processedRequestIndices: result.processedRequestIndices,
    };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: VscodeCopilotCursor,
  ): VscodeCopilotCursor {
    const r = result as VscodeCopilotParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      processedRequestIndices: r.processedRequestIndices,
      requestMeta: r.requestMeta,
      updatedAt: new Date().toISOString(),
    };
  },
};

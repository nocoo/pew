/**
 * GitHub Copilot CLI file token driver.
 *
 * Strategy: Byte-offset streaming of process log files.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: parseCopilotCliFile({ filePath, startOffset })
 *
 * Data location: ~/.copilot/logs/process-*.log
 * Each file is a structured text log with embedded telemetry JSON blocks.
 * The `assistant_usage` event contains per-request token breakdowns.
 */

import type { ByteOffsetCursor } from "@pew/core";
import { discoverCopilotCliFiles } from "../../discovery/sources.js";
import { parseCopilotCliFile } from "../../parsers/copilot-cli.js";
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

interface CopilotCliParseResult extends TokenParseResult {
  endOffset: number;
}

export const copilotCliTokenDriver: FileTokenDriver<ByteOffsetCursor> = {
  kind: "file",
  source: "copilot-cli",

  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.copilotCliLogsDir) return [];
    return discoverCopilotCliFiles(opts.copilotCliLogsDir);
  },

  shouldSkip(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): ByteOffsetResumeState {
    const startOffset =
      cursor && cursor.inode === fingerprint.inode ? (cursor.offset ?? 0) : 0;
    return { kind: "byte-offset", startOffset };
  },

  async parse(filePath: string, resume: ResumeState): Promise<CopilotCliParseResult> {
    const r = resume as ByteOffsetResumeState;
    const result = await parseCopilotCliFile({ filePath, startOffset: r.startOffset });
    return { deltas: result.deltas, endOffset: result.endOffset };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: ByteOffsetCursor,
  ): ByteOffsetCursor {
    const r = result as CopilotCliParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      updatedAt: new Date().toISOString(),
    };
  },
};

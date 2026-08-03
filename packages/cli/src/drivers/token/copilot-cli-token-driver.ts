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
import {
  discoverCopilotCliFiles,
  discoverCopilotOtelFiles,
} from "../../discovery/sources.js";
import { parseCopilotCliFile } from "../../parsers/copilot-cli.js";
import { parseCopilotOtelFile } from "../../parsers/copilot-otel.js";
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

  async discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]> {
    const processLogs = opts.copilotCliLogsDir
      ? await discoverCopilotCliFiles(opts.copilotCliLogsDir)
      : [];
    const otelFiles = opts.copilotCliOtelPaths
      ? await discoverCopilotOtelFiles(opts.copilotCliOtelPaths)
      : [];
    // Remember which paths came from the OTel side. COPILOT_OTEL_FILE_EXPORTER_PATH
    // accepts any filename, so parse() must not infer the format from the
    // extension — a valid `copilot-otel.out` would otherwise be handed to the
    // process-log parser and silently yield nothing.
    ctx.copilotOtelPaths = new Set(otelFiles);
    return [...new Set([...processLogs, ...otelFiles])].sort();
  },

  shouldSkip(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: ByteOffsetCursor | undefined, fingerprint: FileFingerprint): ByteOffsetResumeState {
    const startOffset =
      cursor && cursor.inode === fingerprint.inode ? (cursor.offset ?? 0) : 0;
    return { kind: "byte-offset", startOffset };
  },

  async parse(filePath: string, resume: ResumeState, ctx: SyncContext): Promise<CopilotCliParseResult> {
    const r = resume as ByteOffsetResumeState;
    const result = ctx.copilotOtelPaths?.has(filePath)
      ? await parseCopilotOtelFile({ filePath, startOffset: r.startOffset })
      : await parseCopilotCliFile({ filePath, startOffset: r.startOffset });
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

import type { NotifierStatus, Source } from "@pew/core";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import type { OnCorruptLine } from "../storage/base-queue.js";

/** Resolved source directory paths used for file classification */
export interface SourceDirs {
  claudeDir: string;
  codexSessionsDir: string;
  geminiDir: string;
  openCodeMessageDir: string;
  openclawDir: string;
  vscodeCopilotDirs: string[];
}

/** Status summary for display */
export interface StatusResult {
  /** Number of tracked files */
  trackedFiles: number;
  /** Last sync timestamp (ISO) or null */
  lastSync: string | null;
  /** Number of unuploaded records in queue */
  pendingRecords: number;
  /** Breakdown by source */
  sources: Record<string, number>;
  /** Notifier hook/plugin status by source */
  notifiers: Partial<Record<Source, NotifierStatus>>;
}

/**
 * Classify a cursor file path into a source label.
 *
 * Uses resolved source directories (startsWith) so that custom paths
 * like $CODEX_HOME are classified correctly.
 */
function classifySource(filePath: string, dirs: SourceDirs): string {
  if (filePath.startsWith(dirs.claudeDir)) return "claude-code";
  if (filePath.startsWith(dirs.codexSessionsDir)) return "codex";
  if (filePath.startsWith(dirs.geminiDir)) return "gemini-cli";
  if (filePath.startsWith(dirs.openCodeMessageDir)) return "opencode";
  if (filePath.startsWith(dirs.openclawDir)) return "openclaw";
  for (const dir of dirs.vscodeCopilotDirs) {
    if (filePath.startsWith(dir)) return "vscode-copilot";
  }
  return "unknown";
}

/**
 * Compute the current sync status.
 * Pure logic — no CLI I/O.
 */
export async function executeStatus(opts: {
  stateDir: string;
  sourceDirs: SourceDirs;
  notifierStatuses?: Partial<Record<Source, NotifierStatus>>;
  onCorruptLine?: OnCorruptLine;
}): Promise<StatusResult> {
  const { stateDir, sourceDirs } = opts;

  const cursorStore = new CursorStore(stateDir);
  const queue = new LocalQueue(stateDir, opts.onCorruptLine);

  const cursors = await cursorStore.load();
  const offset = await queue.loadOffset();
  const { records } = await queue.readFromOffset(offset);

  // Count files by source using resolved directory paths
  const sources: Record<string, number> = {};
  for (const filePath of Object.keys(cursors.files)) {
    const source = classifySource(filePath, sourceDirs);
    sources[source] = (sources[source] || 0) + 1;
  }

  return {
    trackedFiles: Object.keys(cursors.files).length,
    lastSync: cursors.updatedAt,
    pendingRecords: records.length,
    sources,
    notifiers: opts.notifierStatuses ?? {},
  };
}

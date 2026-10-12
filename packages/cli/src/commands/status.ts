import type { NotifierStatus, Source } from "@pew/core";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import type { OnCorruptLine } from "../storage/base-queue.js";
import { isRetiredCursorPath } from "../utils/retired-sources.js";
import { relative, isAbsolute } from "node:path";

/** Resolved source directory paths used for file classification */
export interface SourceDirs {
  claudeDir: string;
  codexSessionsDir: string;

  openCodeMessageDir: string;
  openclawDir: string;
  piSessionsDir: string;

  copilotCliLogsDir: string;
  copilotCliOtelPaths: string[];
  multicaCodexDirs: string[];
  /** Grok CLI home (~/.grok) — used to classify log + session cursors */
  grokHome: string;
  /** WorkBuddy data roots (domestic + international) — classify token cursors */
  workbuddyDirs: string[];
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
  // Multica Codex extra dirs
  for (const dir of dirs.multicaCodexDirs) {
    if (filePath.startsWith(dir)) return "codex";
  }

  if (filePath.startsWith(dirs.openCodeMessageDir)) return "opencode";
  if (filePath.startsWith(dirs.openclawDir)) return "openclaw";
  if (filePath.startsWith(dirs.piSessionsDir)) return "pi";
  if (filePath.startsWith(dirs.grokHome)) return "grok";
  for (const dir of dirs.workbuddyDirs) {
    if (filePath.startsWith(dir)) return "workbuddy";
  }
  if (filePath.startsWith(dirs.copilotCliLogsDir)) return "copilot-cli";
  for (const path of dirs.copilotCliOtelPaths) {
    const child = relative(path, filePath);
    if (!isAbsolute(child) && child !== ".." && !child.startsWith("../") && !child.startsWith("..\\")) return "copilot-cli";
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
    if (source === "unknown" && isRetiredCursorPath(filePath)) continue;
    sources[source] = (sources[source] || 0) + 1;
  }
  const antigravityDbs = cursors.antigravity?.dbCount ?? 0;
  if (antigravityDbs > 0) sources.antigravity = antigravityDbs;

  return {
    trackedFiles: Object.values(sources).reduce((sum, count) => sum + count, 0),
    lastSync: cursors.updatedAt,
    pendingRecords: records.length,
    sources,
    notifiers: opts.notifierStatuses ?? {},
  };
}

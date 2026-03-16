import type { CoordinatorRunResult, Source, SyncCycleResult, SyncTrigger } from "@pew/core";
import { executeSync, type SyncOptions } from "./sync.js";
import {
  executeSessionSync,
  type SessionSyncOptions,
} from "./session-sync.js";
import {
  coordinatedSync,
  type CoordinatorOptions,
} from "../notifier/coordinator.js";

export interface NotifyOptions extends SyncOptions {
  source: Source;
  fileHint?: string | null;
  /** Factory for opening the OpenCode SQLite DB for sessions (DI for testability) */
  openSessionDb?: SessionSyncOptions["openSessionDb"];
  /** CLI version string for run log */
  version?: string;
  coordinatedSyncFn?: typeof coordinatedSync;
  executeSyncFn?: (triggers: SyncTrigger[]) => Promise<SyncCycleResult>;
}

export async function executeNotify(
  opts: NotifyOptions,
): Promise<CoordinatorRunResult> {
  const coordinatedSyncFn = opts.coordinatedSyncFn ?? coordinatedSync;
  const executeSyncFn =
    opts.executeSyncFn ??
    (async (): Promise<SyncCycleResult> => {
      const cycle: SyncCycleResult = {};

      // Token sync
      try {
        const tokenResult = await executeSync({
          stateDir: opts.stateDir,
          deviceId: opts.deviceId,
          claudeDir: opts.claudeDir,
          codexSessionsDir: opts.codexSessionsDir,
          geminiDir: opts.geminiDir,
          openCodeMessageDir: opts.openCodeMessageDir,
          openCodeDbPath: opts.openCodeDbPath,
          openMessageDb: opts.openMessageDb,
          openclawDir: opts.openclawDir,
          vscodeCopilotDirs: opts.vscodeCopilotDirs,
          copilotCliLogsDir: opts.copilotCliLogsDir,
        });
        cycle.tokenSync = {
          totalDeltas: tokenResult.totalDeltas,
          totalRecords: tokenResult.totalRecords,
          filesScanned: tokenResult.filesScanned,
          sources: tokenResult.sources,
        };
      } catch (err) {
        cycle.tokenSyncError = err instanceof Error ? err.message : String(err);
      }

      // Session sync
      try {
        const sessionResult = await executeSessionSync({
          stateDir: opts.stateDir,
          claudeDir: opts.claudeDir,
          codexSessionsDir: opts.codexSessionsDir,
          geminiDir: opts.geminiDir,
          openCodeMessageDir: opts.openCodeMessageDir,
          openCodeDbPath: opts.openCodeDbPath,
          openSessionDb: opts.openSessionDb,
          openclawDir: opts.openclawDir,
        });
        cycle.sessionSync = {
          totalSnapshots: sessionResult.totalSnapshots,
          totalRecords: sessionResult.totalRecords,
          filesScanned: sessionResult.filesScanned,
          sources: sessionResult.sources,
        };
      } catch (err) {
        cycle.sessionSyncError = err instanceof Error ? err.message : String(err);
      }

      return cycle;
    });

  const coordinatorOptions: CoordinatorOptions = {
    stateDir: opts.stateDir,
    executeSyncFn,
    version: opts.version,
  };

  return coordinatedSyncFn(
    {
      kind: "notify",
      source: opts.source,
      fileHint: opts.fileHint ?? null,
    },
    coordinatorOptions,
  );
}

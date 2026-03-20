import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
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

  const trigger: SyncTrigger = {
    kind: "notify",
    source: opts.source,
    fileHint: opts.fileHint ?? null,
  };

  const coordinatorOptions: CoordinatorOptions = {
    stateDir: opts.stateDir,
    executeSyncFn,
    version: opts.version,
    cooldownMs: 300_000, // 5 minutes — skip sync if last success was recent
  };

  const result = await coordinatedSyncFn(trigger, coordinatorOptions);

  // --- Trailing-edge guarantee ---
  // When cooldown fires, pending signals are preserved but no future hook
  // is guaranteed to consume them. Schedule a single trailing-edge sync
  // after cooldown expires to ensure the last batch of data is uploaded.
  if (
    result.skippedReason === "cooldown" &&
    result.cooldownRemainingMs != null &&
    result.cooldownRemainingMs > 0
  ) {
    scheduleTrailingSync(
      trigger,
      coordinatorOptions,
      result.cooldownRemainingMs,
      coordinatedSyncFn,
    );
  }

  return result;
}

/**
 * Schedule a trailing-edge sync after cooldown expires.
 *
 * Uses an O_EXCL trailing.lock file to ensure only one process sleeps at a
 * time. If another trailing sync is already scheduled, this is a no-op.
 * The trailing sync runs fire-and-forget — errors are silently ignored.
 */
function scheduleTrailingSync(
  trigger: SyncTrigger,
  opts: CoordinatorOptions,
  delayMs: number,
  coordinatedSyncFn: typeof coordinatedSync,
): void {
  const trailingLockPath = join(opts.stateDir, "trailing.lock");

  // Fire-and-forget: acquire trailing lock, sleep, sync, release
  void (async () => {
    try {
      // O_EXCL: only one trailing sync at a time
      await writeFile(trailingLockPath, String(process.pid), { flag: "wx" });
    } catch {
      // Another process already owns the trailing lock — nothing to do
      return;
    }

    try {
      await new Promise((r) => setTimeout(r, delayMs));
      await coordinatedSyncFn(trigger, opts);
    } catch {
      // Trailing sync errors are non-fatal
    } finally {
      try {
        await unlink(trailingLockPath);
      } catch {
        // Cleanup failure is non-fatal
      }
    }
  })();
}

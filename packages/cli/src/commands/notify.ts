import { writeFile, readFile, unlink } from "node:fs/promises";
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
          kosmosDataDir: opts.kosmosDataDir,
          pmstudioDataDir: opts.pmstudioDataDir,
          openCodeMessageDir: opts.openCodeMessageDir,
          openCodeDbPath: opts.openCodeDbPath,
          openMessageDb: opts.openMessageDb,
          hermesDbPath: opts.hermesDbPath,
          openHermesDb: opts.openHermesDb,
          openclawDir: opts.openclawDir,
          piSessionsDir: opts.piSessionsDir,
          vscodeCopilotDirs: opts.vscodeCopilotDirs,
          copilotCliLogsDir: opts.copilotCliLogsDir,
        });
        cycle.tokenSync = {
          totalDeltas: tokenResult.totalDeltas,
          totalRecords: tokenResult.totalRecords,
          filesScanned: tokenResult.filesScanned,
          dbsScanned: tokenResult.dbsScanned,
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
          kosmosDataDir: opts.kosmosDataDir,
          pmstudioDataDir: opts.pmstudioDataDir,
          openCodeMessageDir: opts.openCodeMessageDir,
          openCodeDbPath: opts.openCodeDbPath,
          openSessionDb: opts.openSessionDb,
          openclawDir: opts.openclawDir,
          piSessionsDir: opts.piSessionsDir,
        });
        cycle.sessionSync = {
          totalSnapshots: sessionResult.totalSnapshots,
          totalRecords: sessionResult.totalRecords,
          filesScanned: sessionResult.filesScanned,
          dbsScanned: sessionResult.dbsScanned,
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
 * Uses an O_EXCL trailing.lock file (containing PID) to ensure only one
 * process sleeps at a time. If a trailing.lock exists from a dead process,
 * it is removed and the lock is re-acquired (stale detection via
 * `process.kill(pid, 0)`). If the lock is held by a live process, this
 * is a no-op.
 *
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
    const acquired = await tryAcquireTrailingLock(trailingLockPath);
    if (!acquired) return;

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

/**
 * Try to acquire the trailing lock. If the lockfile exists, check if the
 * owning PID is still alive. Dead PID → remove stale lock and retry.
 * Live PID → return false (another trailing sync is in progress).
 *
 * @returns `true` if lock was acquired, `false` otherwise.
 */
async function tryAcquireTrailingLock(lockPath: string): Promise<boolean> {
  const lockContent = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  try {
    await writeFile(lockPath, lockContent, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") return false;
  }

  // Lock exists — check if owner is alive
  const ownerPid = await readTrailingLockPid(lockPath);
  if (ownerPid === null) {
    // Corrupted/unreadable — remove and retry
    try { await unlink(lockPath); } catch { return false; }
    try {
      await writeFile(lockPath, lockContent, { flag: "wx" });
      return true;
    } catch { return false; }
  }

  // Check if owner PID is alive
  try {
    process.kill(ownerPid, 0);
    return false; // Process alive — valid lock
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
      // EPERM = process exists but we can't signal it → not stale
      return false;
    }
  }

  // Dead PID — remove stale lock and retry
  try { await unlink(lockPath); } catch { return false; }
  try {
    await writeFile(lockPath, lockContent, { flag: "wx" });
    return true;
  } catch { return false; }
}

/**
 * Read the PID from a trailing.lock file.
 * Returns null on any error (missing, corrupted, etc.).
 */
async function readTrailingLockPid(lockPath: string): Promise<number | null> {
  try {
    const content = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(content);
    if (typeof parsed?.pid === "number") return parsed.pid;
    return null;
  } catch {
    return null;
  }
}

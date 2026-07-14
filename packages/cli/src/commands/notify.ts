import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
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

const ADMISSION_WINDOW_MS = 2_000;
const GATE_GRACE_BUCKETS = 2;
const GATE_FILENAME_RE = /^(?:sync|forward-codex)-(\d+)\.lock$/;

export interface NotifyOptions extends SyncOptions {
  source: Source;
  fileHint?: string | null;
  /** Override: Multica Codex extra session directories */
  multicaCodexDirs?: string[];
  /** Factory for opening the OpenCode SQLite DB for sessions (DI for testability) */
  openSessionDb?: SessionSyncOptions["openSessionDb"];
  /** Factory for opening the ZCode SQLite DB for sessions (DI for testability) */
  openZcodeSessionDb?: SessionSyncOptions["openZcodeSessionDb"];
  /** CLI version string for run log */
  version?: string;
  /**
   * Handler-supplied bucket-end timestamp (epoch ms). Worker sleeps until
   * this instant to close the §4.4 lost-wakeup window. Absent for legacy
   * callers who don't run through the new handler; those keep the old
   * fire-immediately behavior.
   */
  notBefore?: number;
  /** DI: clock, defaults to Date.now — tests inject fixed / stepped clocks. */
  nowFn?: () => number;
  /** DI: sleep, defaults to setTimeout-based — tests short-circuit. */
  delayFn?: (ms: number) => Promise<void>;
  /** DI: hook fired after admission-dir cleanup, before coordinatedSync. */
  onCleanupDone?: () => void;
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
          multicaCodexDirs: opts.multicaCodexDirs,
          geminiDir: opts.geminiDir,
          kosmosDataDir: opts.kosmosDataDir,
          pmstudioDataDir: opts.pmstudioDataDir,
          openCodeMessageDir: opts.openCodeMessageDir,
          openCodeDbPath: opts.openCodeDbPath,
          openMessageDb: opts.openMessageDb,
          hermesDbPath: opts.hermesDbPath,
          hermesProfileDbPaths: opts.hermesProfileDbPaths,
          openHermesDb: opts.openHermesDb,
          openclawDir: opts.openclawDir,
          piSessionsDir: opts.piSessionsDir,
          vscodeCopilotDirs: opts.vscodeCopilotDirs,
          copilotCliLogsDir: opts.copilotCliLogsDir,
          grokLogsPath: opts.grokLogsPath,
          grokSessionsDir: opts.grokSessionsDir,
          zcodeDbPath: opts.zcodeDbPath,
          openZcodeDb: opts.openZcodeDb,
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
          multicaCodexDirs: opts.multicaCodexDirs,
          geminiDir: opts.geminiDir,
          kosmosDataDir: opts.kosmosDataDir,
          pmstudioDataDir: opts.pmstudioDataDir,
          openCodeMessageDir: opts.openCodeMessageDir,
          openCodeDbPath: opts.openCodeDbPath,
          openSessionDb: opts.openSessionDb,
          openclawDir: opts.openclawDir,
          piSessionsDir: opts.piSessionsDir,
          grokLogsPath: opts.grokLogsPath,
          grokSessionsDir: opts.grokSessionsDir,
          zcodeDbPath: opts.zcodeDbPath,
          openZcodeSessionDb: opts.openZcodeSessionDb,
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

  // §4.4: wait until the current bucket has closed, THEN clean expired
  // gate files, THEN enter coordinatedSync(). Cleanup precedes sync so
  // that a lengthy sync.lock wait doesn't let the residual gate count
  // drift up (see doc 45 §10.2 residual ≤ 4).
  const nowFn = opts.nowFn ?? Date.now;
  const delayFn =
    opts.delayFn ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (typeof opts.notBefore === "number") {
    const delayMs = Math.max(0, opts.notBefore - nowFn());
    await delayFn(delayMs);
  }
  await cleanupExpiredGates(opts.stateDir, nowFn());
  opts.onCleanupDone?.();

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
 * Remove `sync-<bucket>.lock` and `forward-codex-<bucket>.lock` files
 * whose bucket number is strictly older than
 * `current_bucket - GATE_GRACE_BUCKETS`. Keeps the current + previous
 * bucket on disk so a paused handler resuming after grace still trips
 * EEXIST (see doc 45 §4.4 + §4.3 post-create expiry check).
 *
 * Scans only `notify-admission/`. Missing directory or errno on
 * unlink is treated as best-effort — cleanup failure never affects
 * correctness (the next worker retries).
 */
async function cleanupExpiredGates(
  stateDir: string,
  now: number,
): Promise<void> {
  const admissionDir = join(stateDir, "notify-admission");
  const currentBucket = Math.floor(now / ADMISSION_WINDOW_MS);
  const cutoff = currentBucket - GATE_GRACE_BUCKETS;

  let entries: string[];
  try {
    entries = await readdir(admissionDir);
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (name) => {
      const match = GATE_FILENAME_RE.exec(name);
      if (!match) return;
      const bucket = Number(match[1]);
      if (!Number.isFinite(bucket) || bucket > cutoff) return;
      try {
        await unlink(join(admissionDir, name));
      } catch {
        // Best-effort — a next worker will retry.
      }
    }),
  );
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

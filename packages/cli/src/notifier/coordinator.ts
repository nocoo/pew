import {
  stat,
  appendFile,
  writeFile,
  readFile,
  unlink,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  CoordinatorRunResult,
  RunLogEntry,
  SyncCycleResult,
  SyncTrigger,
} from "@pew/core";
import {
  acquireLock,
  releaseLock,
  waitForLock,
  type LockFsOps,
  type ProcessOps,
} from "./lockfile.js";

// ---------------------------------------------------------------------------
// Fs abstraction (signal + run log operations)
// ---------------------------------------------------------------------------

export interface FsOps {
  stat: (path: string) => Promise<{ size: number }>;
  appendFile: (path: string, data: string) => Promise<unknown>;
  writeFile: (
    path: string,
    data: string,
    options?: { flag?: string },
  ) => Promise<unknown>;
  readFile: (path: string) => Promise<string>;
  unlink: (path: string) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

const defaultFs: FsOps = {
  stat: stat as unknown as FsOps["stat"],
  appendFile: appendFile as unknown as FsOps["appendFile"],
  writeFile: writeFile as unknown as FsOps["writeFile"],
  readFile: readFile as unknown as FsOps["readFile"],
  unlink: unlink as unknown as FsOps["unlink"],
  mkdir: mkdir as unknown as FsOps["mkdir"],
};

const defaultProcess: ProcessOps = {
  pid: process.pid,
  kill: (pid: number, signal: number) => process.kill(pid, signal),
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CoordinatorOptions {
  stateDir: string;
  executeSyncFn: (triggers: SyncTrigger[]) => Promise<SyncCycleResult>;
  version?: string;
  now?: () => number;
  fs?: FsOps;
  process?: ProcessOps;
  maxFollowUps?: number;
  lockTimeoutMs?: number;
  /**
   * Cooldown duration in ms. If the last successful sync completed less than
   * this many ms ago, skip sync. Set to 0 to disable cooldown.
   * Default: undefined (no cooldown — always runs).
   */
  cooldownMs?: number;
}

const DEFAULT_MAX_FOLLOW_UPS = 3;
const DEFAULT_LOCK_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function coordinatedSync(
  trigger: SyncTrigger,
  opts: CoordinatorOptions,
): Promise<CoordinatorRunResult> {
  const fs = opts.fs ?? defaultFs;
  const proc = opts.process ?? defaultProcess;
  const now = opts.now ?? Date.now;
  const startTime = now();
  const maxFollowUps = opts.maxFollowUps ?? DEFAULT_MAX_FOLLOW_UPS;
  const lockTimeoutMs = opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const runId = `${new Date(startTime).toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseResult: CoordinatorRunResult = {
    runId,
    triggers: [trigger],
    hadFollowUp: false,
    followUpCount: 0,
    waitedForLock: false,
    skippedSync: false,
    degradedToUnlocked: false,
    cycles: [],
  };

  await fs.mkdir(opts.stateDir, { recursive: true });

  let result: CoordinatorRunResult;
  try {
    result = await runCoordinator(
      trigger,
      opts,
      fs,
      proc,
      now,
      maxFollowUps,
      lockTimeoutMs,
      baseResult,
    );
  } catch (err) {
    result = { ...baseResult, error: toErrorMessage(err) };
  }
  await writeRunLog(
    result,
    startTime,
    now,
    opts.version ?? "unknown",
    opts.stateDir,
    fs,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Lock acquisition + coordination loop
// ---------------------------------------------------------------------------

async function runCoordinator(
  trigger: SyncTrigger,
  opts: CoordinatorOptions,
  fs: FsOps,
  proc: ProcessOps,
  now: () => number,
  maxFollowUps: number,
  lockTimeoutMs: number,
  baseResult: CoordinatorRunResult,
): Promise<CoordinatorRunResult> {
  const lockPath = join(opts.stateDir, "sync.lock");
  const lockFs: LockFsOps = {
    writeFile: async (path, data, options) => {
      await fs.writeFile(path, data, options);
    },
    readFile: (path) => fs.readFile(path),
    unlink: async (path) => {
      await fs.unlink(path);
    },
  };

  let acquiredLock = false;
  let waitedForLock = false;

  try {
    // --- Try immediate (non-blocking) lock acquisition ---
    try {
      acquiredLock = await acquireLock(lockPath, { fs: lockFs, process: proc });
    } catch (err) {
      // Fail-closed: lock mechanism broken → skip sync, never run unlocked
      return {
        ...baseResult,
        skippedSync: true,
        error: toErrorMessage(err),
      };
    }

    if (!acquiredLock) {
      // Lock held by another process → append signal + poll wait
      waitedForLock = true;
      await appendSignal(opts.stateDir, fs);

      const waitResult = await waitForLock(lockPath, {
        fs: lockFs,
        process: proc,
        timeoutMs: lockTimeoutMs,
      });

      if (!waitResult.acquired) {
        // Fail-closed: could not acquire lock → skip sync, report error
        return {
          ...baseResult,
          waitedForLock: true,
          skippedSync: true,
          error: waitResult.error ?? "lock timeout",
        };
      }

      acquiredLock = true;

      // --- Waiter dedup: check if the previous holder's follow-up
      //     already consumed our signal ---
      const signalSize = await readSignalSize(opts.stateDir, fs);
      if (signalSize === 0) {
        return {
          ...baseResult,
          waitedForLock: true,
          skippedSync: true,
        };
      }
    }

    // --- We hold the lock — check cooldown before running sync ---
    const cooldownMs = opts.cooldownMs;
    if (cooldownMs != null && cooldownMs > 0) {
      const remainingMs = await checkCooldown(opts.stateDir, fs, now, cooldownMs);
      if (remainingMs > 0) {
        return {
          ...baseResult,
          waitedForLock,
          skippedSync: true,
          skippedReason: "cooldown",
          cooldownRemainingMs: remainingMs,
        };
      }
    }

    // --- Run sync cycles ---
    const lockedResult = await runLockedCycles({
      stateDir: opts.stateDir,
      fs,
      executeSyncFn: opts.executeSyncFn,
      trigger,
      maxFollowUps,
    });

    return {
      ...baseResult,
      ...lockedResult,
      waitedForLock,
    };
  } finally {
    if (acquiredLock) {
      await releaseLock(lockPath, { fs: lockFs, process: proc });
    }
  }
}

// ---------------------------------------------------------------------------
// Locked cycle loop (unchanged semantics from original coordinator)
// ---------------------------------------------------------------------------

async function runLockedCycles({
  stateDir,
  fs,
  executeSyncFn,
  trigger,
  maxFollowUps,
}: {
  stateDir: string;
  fs: FsOps;
  executeSyncFn: (triggers: SyncTrigger[]) => Promise<SyncCycleResult>;
  trigger: SyncTrigger;
  maxFollowUps: number;
}): Promise<
  Pick<
    CoordinatorRunResult,
    "hadFollowUp" | "followUpCount" | "skippedSync" | "cycles" | "error"
  >
> {
  let hadFollowUp = false;
  let error: string | undefined;
  let followUps = 0;
  const cycles: SyncCycleResult[] = [];

  while (true) {
    await truncateSignal(stateDir, fs);

    try {
      const cycleResult = await executeSyncFn([trigger]);
      cycles.push(cycleResult);
    } catch (err) {
      error ??= toErrorMessage(err);
      cycles.push({});
    }

    const signalSize = await readSignalSize(stateDir, fs);
    if (signalSize === 0) break;
    if (followUps >= maxFollowUps) break;
    hadFollowUp = true;
    followUps += 1;
  }

  return {
    hadFollowUp,
    followUpCount: followUps,
    skippedSync: false,
    cycles,
    error,
  };
}

// ---------------------------------------------------------------------------
// Status derivation + run log (unchanged from original)
// ---------------------------------------------------------------------------

function deriveStatus(result: CoordinatorRunResult): RunLogEntry["status"] {
  if (result.skippedSync) return "skipped";

  // Coordinator-level error with no cycles means the run itself failed
  if (result.error != null && result.cycles.length === 0) return "error";
  if (result.cycles.length === 0) return "skipped";

  const hasError =
    result.cycles.some(
      (c) => c.tokenSyncError != null || c.sessionSyncError != null,
    ) || result.error != null;

  const hasSuccess = result.cycles.some(
    (c) => c.tokenSync != null || c.sessionSync != null,
  );

  if (hasError && hasSuccess) return "partial";
  if (hasError) return "error";
  return "success";
}

async function writeRunLog(
  result: CoordinatorRunResult,
  startTime: number,
  now: () => number,
  version: string,
  stateDir: string,
  fs: FsOps,
): Promise<void> {
  try {
    const completedAt = now();
    const entry: RunLogEntry = {
      runId: result.runId,
      version,
      triggers: result.triggers,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startTime,
      coordination: {
        waitedForLock: result.waitedForLock,
        skippedSync: result.skippedSync,
        ...(result.skippedReason != null
          ? { skippedReason: result.skippedReason }
          : {}),
        ...(result.cooldownRemainingMs != null
          ? { cooldownRemainingMs: result.cooldownRemainingMs }
          : {}),
        hadFollowUp: result.hadFollowUp,
        followUpCount: result.followUpCount,
        degradedToUnlocked: result.degradedToUnlocked,
      },
      cycles: result.cycles,
      status: deriveStatus(result),
      ...(result.error != null ? { error: result.error } : {}),
    };

    const json = JSON.stringify(entry, null, 2);
    const runsDir = join(stateDir, "runs");
    await fs.mkdir(runsDir, { recursive: true });
    await fs.writeFile(join(runsDir, `${result.runId}.json`), json);
    await fs.writeFile(join(stateDir, "last-run.json"), json);

    // Write last-success.json only on success — used exclusively by cooldown.
    // Kept separate from last-run.json so skipped/error runs don't overwrite
    // the success timestamp.
    if (entry.status === "success") {
      await fs.writeFile(
        join(stateDir, "last-success.json"),
        entry.completedAt,
      );
    }
  } catch {
    // Run log write failures are non-fatal
  }
}

// ---------------------------------------------------------------------------
// Cooldown check
// ---------------------------------------------------------------------------

/**
 * Check if the last successful sync completed within the cooldown window.
 * Returns the remaining cooldown time in ms, or 0 if cooldown is not active.
 *
 * Reads `last-success.json` (a plain ISO timestamp), which is only written
 * after a successful sync. This avoids the problem where `last-run.json`
 * (written on every run including skipped/error) would overwrite the success
 * timestamp and break cooldown for subsequent runs.
 */
async function checkCooldown(
  stateDir: string,
  fs: FsOps,
  now: () => number,
  cooldownMs: number,
): Promise<number> {
  const lastSuccessAt = await readLastSuccessAt(stateDir, fs);
  if (lastSuccessAt == null) return 0;

  const completedAtMs = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(completedAtMs)) return 0;

  const elapsed = now() - completedAtMs;
  const remaining = cooldownMs - elapsed;
  return remaining > 0 ? remaining : 0;
}

/**
 * Read the last-success.json file (plain ISO timestamp string).
 * Returns null on any error (missing file, corrupted, etc.).
 */
async function readLastSuccessAt(
  stateDir: string,
  fs: FsOps,
): Promise<string | null> {
  try {
    const content = await fs.readFile(join(stateDir, "last-success.json"));
    const trimmed = String(content).trim();
    if (trimmed.length === 0) return null;
    return trimmed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Signal file helpers (unchanged from original)
// ---------------------------------------------------------------------------

async function readSignalSize(stateDir: string, fs: FsOps): Promise<number> {
  try {
    const file = await fs.stat(join(stateDir, "notify.signal"));
    return file.size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return 0;
    }
    throw err;
  }
}

async function appendSignal(stateDir: string, fs: FsOps): Promise<void> {
  await fs.appendFile(join(stateDir, "notify.signal"), "\n");
}

async function truncateSignal(stateDir: string, fs: FsOps): Promise<void> {
  await fs.writeFile(join(stateDir, "notify.signal"), "");
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

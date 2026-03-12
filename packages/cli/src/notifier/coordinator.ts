import { open, stat, appendFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CoordinatorRunResult, RunLogEntry, SyncCycleResult, SyncTrigger } from "@pew/core";

interface LockHandle {
  lock?(mode?: string, options?: { nonBlocking?: boolean }): Promise<void>;
  close(): Promise<void>;
}

interface FsOps {
  open: (path: string, flags: string) => Promise<LockHandle>;
  stat: (path: string) => Promise<{ size: number }>;
  appendFile: (path: string, data: string) => Promise<unknown>;
  writeFile: (path: string, data: string) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

const defaultFs: FsOps = {
  open: open as unknown as FsOps["open"],
  stat: stat as unknown as FsOps["stat"],
  appendFile: appendFile as unknown as FsOps["appendFile"],
  writeFile: writeFile as unknown as FsOps["writeFile"],
  mkdir: mkdir as unknown as FsOps["mkdir"],
};

export interface CoordinatorOptions {
  stateDir: string;
  executeSyncFn: (triggers: SyncTrigger[]) => Promise<SyncCycleResult>;
  version?: string;
  now?: () => number;
  fs?: FsOps;
  maxFollowUps?: number;
  lockTimeoutMs?: number;
}

const DEFAULT_MAX_FOLLOW_UPS = 3;
const DEFAULT_LOCK_TIMEOUT_MS = 60_000;

export async function coordinatedSync(
  trigger: SyncTrigger,
  opts: CoordinatorOptions,
): Promise<CoordinatorRunResult> {
  const fs = opts.fs ?? defaultFs;
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
    result = await runCoordinator(trigger, opts, fs, now, maxFollowUps, lockTimeoutMs, baseResult);
  } catch (err) {
    result = { ...baseResult, error: toErrorMessage(err) };
  }
  await writeRunLog(result, startTime, now, opts.version ?? "unknown", opts.stateDir, fs);
  return result;
}

/* eslint-disable no-useless-assignment -- `closeHandled`/`acquiredLock` are read in `finally` block */
async function runCoordinator(
  trigger: SyncTrigger,
  opts: CoordinatorOptions,
  fs: FsOps,
  now: () => number,
  maxFollowUps: number,
  lockTimeoutMs: number,
  baseResult: CoordinatorRunResult,
): Promise<CoordinatorRunResult> {
  const lockPath = join(opts.stateDir, "sync.lock");
  let handle: LockHandle | null = null;
  let closeHandled = false;
  let acquiredLock = false;
  let waitedForLock = false;

  try {
    handle = await fs.open(lockPath, "a+");
    if (typeof handle.lock !== "function") {
      await handle.close().catch(() => {});
      closeHandled = true;
      return runUnlocked(baseResult, trigger, opts.executeSyncFn);
    }
    await handle.lock("exclusive", { nonBlocking: true });
    acquiredLock = true;
  } catch (error) {
    if (!handle) {
      return runUnlocked(baseResult, trigger, opts.executeSyncFn);
    }

    const lockHandle = handle;
    if (isWouldBlockError(error)) {
      waitedForLock = true;
      await appendSignal(opts.stateDir, fs);
      try {
        if (typeof lockHandle.lock !== "function") {
          throw new Error("lock unsupported", { cause: error });
        }
        await withTimeout(lockHandle.lock("exclusive"), lockTimeoutMs);
      } catch {
        await lockHandle.close();
        closeHandled = true;
        return {
          ...baseResult,
          waitedForLock: true,
          skippedSync: true,
          error: "lock timeout",
        };
      }

      acquiredLock = true;
      const signalSize = await readSignalSize(opts.stateDir, fs);
      if (signalSize === 0) {
        await lockHandle.close();
        closeHandled = true;
        return {
          ...baseResult,
          waitedForLock: true,
          skippedSync: true,
        };
      }
    } else {
      await lockHandle.close().catch(() => {});
      closeHandled = true;
      return runUnlocked(baseResult, trigger, opts.executeSyncFn);
    }
  }

  try {
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
    if (acquiredLock && handle && !closeHandled) {
      await handle.close().catch(() => {});
    }
  }
}
/* eslint-enable no-useless-assignment */

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
}): Promise<Pick<CoordinatorRunResult, "hadFollowUp" | "followUpCount" | "skippedSync" | "cycles" | "error">> {
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

  return { hadFollowUp, followUpCount: followUps, skippedSync: false, cycles, error };
}

async function runUnlocked(
  baseResult: CoordinatorRunResult,
  trigger: SyncTrigger,
  executeSyncFn: (triggers: SyncTrigger[]) => Promise<SyncCycleResult>,
): Promise<CoordinatorRunResult> {
  try {
    const cycleResult = await executeSyncFn([trigger]);
    return {
      ...baseResult,
      degradedToUnlocked: true,
      cycles: [cycleResult],
    };
  } catch (err) {
    return {
      ...baseResult,
      degradedToUnlocked: true,
      cycles: [{}],
      error: toErrorMessage(err),
    };
  }
}

function deriveStatus(result: CoordinatorRunResult): RunLogEntry["status"] {
  if (result.skippedSync) return "skipped";

  // Coordinator-level error with no cycles means the run itself failed
  if (result.error != null && result.cycles.length === 0) return "error";
  if (result.cycles.length === 0) return "skipped";

  const hasError = result.cycles.some(
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
  } catch {
    // Run log write failures are non-fatal
  }
}

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

function isWouldBlockError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EAGAIN" || code === "EWOULDBLOCK";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("lock timeout"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

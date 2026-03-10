import { open, stat, appendFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CoordinatorRunResult, SyncCycleResult, SyncTrigger } from "@pew/core";

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
  const maxFollowUps = opts.maxFollowUps ?? DEFAULT_MAX_FOLLOW_UPS;
  const lockTimeoutMs = opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const runId = `${new Date(now()).toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
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
          throw new Error("lock unsupported");
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

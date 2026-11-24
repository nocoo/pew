/**
 * O_EXCL-based lockfile with PID-based stale detection.
 *
 * Provides cross-process mutual exclusion that works on all Node.js/Bun
 * versions (unlike FileHandle.lock() which requires Node 22+).
 *
 * The lockfile contains `{ pid, startedAt }` JSON. Stale detection uses
 * `process.kill(pid, 0)` — PID-only, no age-based checks (a slow fetch()
 * is still a valid lock holder).
 */

// ---------------------------------------------------------------------------
// Dependency injection interfaces
// ---------------------------------------------------------------------------

export interface LockFsOps {
  writeFile(path: string, data: string, options?: { flag?: string }): Promise<void>;
  readFile(path: string): Promise<string>;
  unlink(path: string): Promise<void>;
}

export interface ProcessOps {
  readonly pid: number;
  kill(pid: number, signal: number): boolean;
}

// ---------------------------------------------------------------------------
// acquireLock — O_EXCL atomic create
// ---------------------------------------------------------------------------

/**
 * Try to create the lockfile atomically (O_EXCL).
 *
 * @returns `true` if acquired, `false` if another lockfile already exists.
 * @throws On unexpected fs errors (not EEXIST).
 */
export async function acquireLock(
  lockPath: string,
  opts: { fs: LockFsOps; process: ProcessOps },
): Promise<boolean> {
  const content = JSON.stringify({
    pid: opts.process.pid,
    startedAt: new Date().toISOString(),
  });
  try {
    await opts.fs.writeFile(lockPath, content, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// releaseLock — unlink only if we own the lockfile
// ---------------------------------------------------------------------------

/**
 * Release the lockfile by unlinking it, but only if the PID inside matches
 * our own. Silently handles all errors (lockfile already gone, permission
 * issues, corrupted content).
 */
export async function releaseLock(
  lockPath: string,
  opts: { fs: LockFsOps; process: ProcessOps },
): Promise<void> {
  try {
    const pid = await readLockPid(lockPath, { fs: opts.fs });
    if (pid !== opts.process.pid) return;
    await opts.fs.unlink(lockPath);
  } catch {
    // Best-effort cleanup — don't let release failures propagate
  }
}

// ---------------------------------------------------------------------------
// readLockPid — parse PID from lockfile content
// ---------------------------------------------------------------------------

/**
 * Read and parse the PID from a lockfile.
 *
 * @returns The PID number, or `null` if the file doesn't exist or is
 *          corrupted/unparseable.
 */
export async function readLockPid(
  lockPath: string,
  opts: { fs: Pick<LockFsOps, "readFile"> },
): Promise<number | null> {
  try {
    const content = await opts.fs.readFile(lockPath);
    const parsed = JSON.parse(content);
    if (typeof parsed?.pid === "number") return parsed.pid;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// isLockStale — PID-based stale detection
// ---------------------------------------------------------------------------

/**
 * Check if the lockfile is stale (owner process is dead).
 *
 * - PID dead (ESRCH) → stale
 * - PID alive → not stale
 * - PID alive but no permission (EPERM) → not stale (process exists)
 * - Lockfile missing or corrupted → stale (nothing to protect)
 */
export async function isLockStale(
  lockPath: string,
  opts: { fs: Pick<LockFsOps, "readFile">; process: ProcessOps },
): Promise<boolean> {
  const pid = await readLockPid(lockPath, { fs: opts.fs });
  if (pid === null) return true;

  // Our own PID — not stale
  if (pid === opts.process.pid) return false;

  try {
    opts.process.kill(pid, 0);
    return false; // Process exists
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return true; // No such process
    // EPERM = process exists but we can't signal it → not stale
    return false;
  }
}

// ---------------------------------------------------------------------------
// waitForLock — poll with exponential backoff
// ---------------------------------------------------------------------------

export interface WaitForLockResult {
  acquired: boolean;
  error?: string;
}

/**
 * Poll for the lockfile to become available with exponential backoff.
 *
 * If the current holder's PID is dead, removes the stale lockfile and
 * retries acquisition. Gives up after `timeoutMs`.
 *
 * Backoff: starts at 100ms, doubles each iteration, caps at 2000ms.
 */
export async function waitForLock(
  lockPath: string,
  opts: {
    fs: LockFsOps;
    process: ProcessOps;
    timeoutMs: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<WaitForLockResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const startTime = now();
  let backoff = 100;
  const maxBackoff = 2000;

  while (true) {
    // Check if stale → remove and retry
    const stale = await isLockStale(lockPath, {
      fs: opts.fs,
      process: opts.process,
    });
    if (stale) {
      try {
        await opts.fs.unlink(lockPath);
      } catch {
        // May already be removed by another process — fine
      }
    }

    // Try to acquire
    const acquired = await acquireLock(lockPath, {
      fs: opts.fs,
      process: opts.process,
    });
    if (acquired) return { acquired: true };

    // Check timeout
    const elapsed = now() - startTime;
    if (elapsed >= opts.timeoutMs) {
      return { acquired: false, error: "lock timeout" };
    }

    await sleep(backoff);
    backoff = Math.min(backoff * 2, maxBackoff);
  }
}

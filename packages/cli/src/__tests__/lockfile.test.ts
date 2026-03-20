import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  releaseLock,
  isLockStale,
  waitForLock,
  readLockPid,
  type LockFsOps,
  type ProcessOps,
} from "../notifier/lockfile.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake fs that tracks lockfile state in memory */
function createFakeFs(opts?: {
  lockContent?: string | null;
  readThrows?: Error;
  writeThrows?: Error;
  unlinkThrows?: Error;
}): LockFsOps & { _state: { content: string | null } } {
  const state = { content: opts?.lockContent ?? null };

  return {
    _state: state,

    async writeFile(path: string, data: string, options?: { flag?: string }) {
      if (opts?.writeThrows) throw opts.writeThrows;
      if (options?.flag === "wx" && state.content !== null) {
        const err = new Error("EEXIST") as NodeJS.ErrnoException;
        err.code = "EEXIST";
        throw err;
      }
      state.content = data;
    },

    async readFile(path: string): Promise<string> {
      if (opts?.readThrows) throw opts.readThrows;
      if (state.content === null) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return state.content;
    },

    async unlink(path: string): Promise<void> {
      if (opts?.unlinkThrows) throw opts.unlinkThrows;
      state.content = null;
    },
  };
}

function createFakeProcess(opts?: {
  pid?: number;
  killThrows?: Map<number, string>;
}): ProcessOps {
  const pid = opts?.pid ?? 12345;
  const killThrows = opts?.killThrows ?? new Map();

  return {
    pid,
    kill(targetPid: number, signal: number): boolean {
      const errCode = killThrows.get(targetPid);
      if (errCode) {
        const err = new Error(errCode) as NodeJS.ErrnoException;
        err.code = errCode;
        throw err;
      }
      return true;
    },
  };
}

function lockContent(pid: number, startedAt = "2026-03-20T01:00:00.000Z"): string {
  return JSON.stringify({ pid, startedAt });
}

// ---------------------------------------------------------------------------
// acquireLock
// ---------------------------------------------------------------------------

describe("acquireLock", () => {
  it("creates a lockfile with O_EXCL when no lockfile exists", async () => {
    const fs = createFakeFs();
    const proc = createFakeProcess({ pid: 9999 });

    const result = await acquireLock("/tmp/sync.lock", { fs, process: proc });

    expect(result).toBe(true);
    expect(fs._state.content).not.toBeNull();
    const parsed = JSON.parse(fs._state.content!);
    expect(parsed.pid).toBe(9999);
    expect(parsed.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns false when lockfile already exists (EEXIST)", async () => {
    const fs = createFakeFs({ lockContent: lockContent(8888) });
    const proc = createFakeProcess({ pid: 9999 });

    const result = await acquireLock("/tmp/sync.lock", { fs, process: proc });

    expect(result).toBe(false);
    // Original lockfile unchanged
    const parsed = JSON.parse(fs._state.content!);
    expect(parsed.pid).toBe(8888);
  });

  it("throws on unexpected write errors (not EEXIST)", async () => {
    const err = new Error("EACCES") as NodeJS.ErrnoException;
    err.code = "EACCES";
    const fs = createFakeFs({ writeThrows: err });
    const proc = createFakeProcess();

    await expect(
      acquireLock("/tmp/sync.lock", { fs, process: proc }),
    ).rejects.toThrow("EACCES");
  });
});

// ---------------------------------------------------------------------------
// releaseLock
// ---------------------------------------------------------------------------

describe("releaseLock", () => {
  it("removes lockfile when PID matches", async () => {
    const fs = createFakeFs({ lockContent: lockContent(9999) });
    const proc = createFakeProcess({ pid: 9999 });

    await releaseLock("/tmp/sync.lock", { fs, process: proc });

    expect(fs._state.content).toBeNull();
  });

  it("does NOT remove lockfile when PID does not match", async () => {
    const fs = createFakeFs({ lockContent: lockContent(8888) });
    const proc = createFakeProcess({ pid: 9999 });

    await releaseLock("/tmp/sync.lock", { fs, process: proc });

    // Lockfile still exists with original PID
    expect(fs._state.content).not.toBeNull();
    const parsed = JSON.parse(fs._state.content!);
    expect(parsed.pid).toBe(8888);
  });

  it("silently handles lockfile already removed (ENOENT on read)", async () => {
    const fs = createFakeFs({ lockContent: null });
    const proc = createFakeProcess({ pid: 9999 });

    // Should not throw
    await releaseLock("/tmp/sync.lock", { fs, process: proc });
  });

  it("silently handles unlink failure", async () => {
    const err = new Error("EPERM") as NodeJS.ErrnoException;
    err.code = "EPERM";
    const fs = createFakeFs({
      lockContent: lockContent(9999),
      unlinkThrows: err,
    });
    const proc = createFakeProcess({ pid: 9999 });

    // Should not throw
    await releaseLock("/tmp/sync.lock", { fs, process: proc });
  });

  it("silently handles corrupted lockfile content (unparseable JSON)", async () => {
    const fs = createFakeFs({ lockContent: "not json" });
    const proc = createFakeProcess({ pid: 9999 });

    // Should not throw
    await releaseLock("/tmp/sync.lock", { fs, process: proc });
  });
});

// ---------------------------------------------------------------------------
// readLockPid
// ---------------------------------------------------------------------------

describe("readLockPid", () => {
  it("returns the PID from a valid lockfile", async () => {
    const fs = createFakeFs({ lockContent: lockContent(12345) });
    const pid = await readLockPid("/tmp/sync.lock", { fs });
    expect(pid).toBe(12345);
  });

  it("returns null when lockfile does not exist", async () => {
    const fs = createFakeFs({ lockContent: null });
    const pid = await readLockPid("/tmp/sync.lock", { fs });
    expect(pid).toBeNull();
  });

  it("returns null when lockfile content is corrupted", async () => {
    const fs = createFakeFs({ lockContent: "garbage" });
    const pid = await readLockPid("/tmp/sync.lock", { fs });
    expect(pid).toBeNull();
  });

  it("returns null when lockfile JSON has no pid field", async () => {
    const fs = createFakeFs({ lockContent: JSON.stringify({ startedAt: "x" }) });
    const pid = await readLockPid("/tmp/sync.lock", { fs });
    expect(pid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isLockStale
// ---------------------------------------------------------------------------

describe("isLockStale", () => {
  it("returns true when the PID is dead (ESRCH)", async () => {
    const fs = createFakeFs({ lockContent: lockContent(7777) });
    const proc = createFakeProcess({
      pid: 9999,
      killThrows: new Map([[7777, "ESRCH"]]),
    });

    const stale = await isLockStale("/tmp/sync.lock", { fs, process: proc });
    expect(stale).toBe(true);
  });

  it("returns false when the PID is alive", async () => {
    const fs = createFakeFs({ lockContent: lockContent(7777) });
    const proc = createFakeProcess({ pid: 9999 });
    // Default: kill doesn't throw → PID is alive

    const stale = await isLockStale("/tmp/sync.lock", { fs, process: proc });
    expect(stale).toBe(false);
  });

  it("returns false when the PID is alive but we lack permission (EPERM)", async () => {
    const fs = createFakeFs({ lockContent: lockContent(7777) });
    const proc = createFakeProcess({
      pid: 9999,
      killThrows: new Map([[7777, "EPERM"]]),
    });

    // EPERM means the process exists but we can't signal it — not stale
    const stale = await isLockStale("/tmp/sync.lock", { fs, process: proc });
    expect(stale).toBe(false);
  });

  it("returns true when lockfile does not exist (nothing to lock)", async () => {
    const fs = createFakeFs({ lockContent: null });
    const proc = createFakeProcess();

    const stale = await isLockStale("/tmp/sync.lock", { fs, process: proc });
    expect(stale).toBe(true);
  });

  it("returns true when lockfile content is corrupted", async () => {
    const fs = createFakeFs({ lockContent: "not json" });
    const proc = createFakeProcess();

    const stale = await isLockStale("/tmp/sync.lock", { fs, process: proc });
    expect(stale).toBe(true);
  });

  it("returns false when it is our own PID (self-check)", async () => {
    const fs = createFakeFs({ lockContent: lockContent(9999) });
    const proc = createFakeProcess({ pid: 9999 });

    const stale = await isLockStale("/tmp/sync.lock", { fs, process: proc });
    expect(stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// waitForLock
// ---------------------------------------------------------------------------

describe("waitForLock", () => {
  it("acquires the lock immediately if lockfile becomes available on first try", async () => {
    const fs = createFakeFs({ lockContent: null });
    const proc = createFakeProcess({ pid: 9999 });

    const result = await waitForLock("/tmp/sync.lock", {
      fs,
      process: proc,
      timeoutMs: 5000,
    });

    expect(result.acquired).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("acquires the lock after stale lockfile is removed", async () => {
    // Lock held by dead process
    const fs = createFakeFs({ lockContent: lockContent(7777) });
    const proc = createFakeProcess({
      pid: 9999,
      killThrows: new Map([[7777, "ESRCH"]]),
    });

    const result = await waitForLock("/tmp/sync.lock", {
      fs,
      process: proc,
      timeoutMs: 10000,
      sleep: async () => {},
    });

    expect(result.acquired).toBe(true);
  });

  it("times out when lock is held by a live process", async () => {
    const fs = createFakeFs({ lockContent: lockContent(7777) });
    const proc = createFakeProcess({ pid: 9999 });
    // PID 7777 is alive (kill doesn't throw)

    let elapsed = 0;
    const fakeSleep = async (ms: number) => {
      elapsed += ms;
    };

    // Use a short timeout and simulate time passing via fakeSleep
    const result = await waitForLock("/tmp/sync.lock", {
      fs,
      process: proc,
      timeoutMs: 500,
      sleep: fakeSleep,
      now: () => elapsed,
    });

    expect(result.acquired).toBe(false);
    expect(result.error).toContain("lock timeout");
  });

  it("acquires the lock after the holder releases it mid-poll", async () => {
    const fs = createFakeFs({ lockContent: lockContent(7777) });
    const proc = createFakeProcess({ pid: 9999 });
    // PID 7777 is alive initially

    let pollCount = 0;
    const fakeSleep = async () => {
      pollCount++;
      if (pollCount >= 2) {
        // Simulate lock released after 2 polls
        fs._state.content = null;
      }
    };

    const result = await waitForLock("/tmp/sync.lock", {
      fs,
      process: proc,
      timeoutMs: 60000,
      sleep: fakeSleep,
    });

    expect(result.acquired).toBe(true);
  });

  it("uses exponential backoff starting at 100ms, capped at 2000ms", async () => {
    const fs = createFakeFs({ lockContent: lockContent(7777) });
    const proc = createFakeProcess({ pid: 9999 });
    // PID 7777 is alive → lock never becomes available

    const sleepDurations: number[] = [];
    let elapsed = 0;
    const fakeSleep = async (ms: number) => {
      sleepDurations.push(ms);
      elapsed += ms;
    };

    await waitForLock("/tmp/sync.lock", {
      fs,
      process: proc,
      timeoutMs: 10000,
      sleep: fakeSleep,
      now: () => elapsed,
    });

    // Verify backoff pattern: 100, 200, 400, 800, 1600, 2000 (capped), 2000, ...
    expect(sleepDurations[0]).toBe(100);
    expect(sleepDurations[1]).toBe(200);
    expect(sleepDurations[2]).toBe(400);
    expect(sleepDurations[3]).toBe(800);
    expect(sleepDurations[4]).toBe(1600);
    expect(sleepDurations[5]).toBe(2000);
    // After cap, all should be 2000
    if (sleepDurations.length > 6) {
      expect(sleepDurations[6]).toBe(2000);
    }
  });
});

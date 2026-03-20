import { describe, expect, it, vi } from "vitest";
import type { RunLogEntry, SyncCycleResult, SyncTrigger } from "@pew/core";
import { coordinatedSync } from "../notifier/coordinator.js";
import type { FsOps } from "../notifier/coordinator.js";
import type { ProcessOps } from "../notifier/lockfile.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeFsState {
  signalSize: number;
  appendCalls: number;
  truncateCalls: number;
  mkdirCalls: number;
  signalExists: boolean;
  /** Simulate lockfile: null = no lockfile, string = lockfile content */
  lockContent: string | null;
  /** Simulate last-run.json: null = no file, string = JSON content */
  lastRunContent: string | null;
}

function createTrigger(): SyncTrigger {
  return { kind: "notify", source: "codex", fileHint: "/tmp/rollout.jsonl" };
}

function createFakeProcess(pid = 9999): ProcessOps {
  return {
    pid,
    kill: (_pid: number, _signal: number) => true,
  };
}

/**
 * Create a fake fs for coordinator tests.
 *
 * The `lockContent` state simulates the lockfile:
 * - `null` means no lockfile on disk (acquireLock will succeed)
 * - A string means a lockfile exists (acquireLock will EEXIST)
 *
 * The `onLockAcquired` callback is invoked when a lock is "acquired"
 * (i.e. writeFile with flag="wx" succeeds), allowing tests to simulate
 * concurrent behavior.
 */
function createFakeFs(state?: Partial<FakeFsState>, opts?: {
  onLockAcquired?: () => void;
  statOverride?: () => Promise<{ size: number }>;
}) {
  const fakeState: FakeFsState = {
    signalSize: 0,
    appendCalls: 0,
    truncateCalls: 0,
    mkdirCalls: 0,
    signalExists: true,
    lockContent: null,
    lastRunContent: null,
    ...state,
  };

  const fs: FsOps = {
    stat: opts?.statOverride ?? vi.fn(async () => {
      if (!fakeState.signalExists) {
        const err = new Error("missing") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return { size: fakeState.signalSize };
    }),

    appendFile: vi.fn(async (_path: string, content: string) => {
      fakeState.signalExists = true;
      fakeState.appendCalls += 1;
      fakeState.signalSize += Buffer.byteLength(content);
    }),

    writeFile: vi.fn(async (_path: string, content: string, options?: { flag?: string }) => {
      if (options?.flag === "wx") {
        // O_EXCL lockfile creation
        if (fakeState.lockContent !== null) {
          const err = new Error("EEXIST") as NodeJS.ErrnoException;
          err.code = "EEXIST";
          throw err;
        }
        fakeState.lockContent = content;
        opts?.onLockAcquired?.();
        return;
      }
      // Regular writeFile — signal truncation or run log
      fakeState.signalExists = true;
      fakeState.truncateCalls += 1;
      fakeState.signalSize = Buffer.byteLength(content);
    }),

    readFile: vi.fn(async (path: string) => {
      if (path.endsWith("sync.lock")) {
        if (fakeState.lockContent === null) {
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return fakeState.lockContent;
      }
      if (path.endsWith("last-run.json")) {
        if (fakeState.lastRunContent === null) {
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return fakeState.lastRunContent;
      }
      throw new Error("readFile: unexpected path " + path);
    }),

    unlink: vi.fn(async (path: string) => {
      if (path.endsWith("sync.lock")) {
        fakeState.lockContent = null;
        return;
      }
      throw new Error("unlink: unexpected path " + path);
    }),

    mkdir: vi.fn(async () => {
      fakeState.mkdirCalls += 1;
    }),
  };

  return { state: fakeState, fs };
}

/** Extract the RunLogEntry written to last-run.json from the fake fs writeFile calls */
function extractRunLog(fs: FsOps): RunLogEntry | undefined {
  const calls = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls as [string, string, unknown?][];
  const logCall = calls.find(([path]) => path.endsWith("last-run.json"));
  return logCall ? JSON.parse(logCall[1]) : undefined;
}

// ---------------------------------------------------------------------------
// coordinatedSync — lock acquisition
// ---------------------------------------------------------------------------

describe("coordinatedSync", () => {
  it("runs a single sync when the lock is immediately available", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => Date.parse("2026-03-09T10:00:00.000Z"),
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.waitedForLock).toBe(false);
    expect(result.skippedSync).toBe(false);
    expect(result.runId).toMatch(/^2026-03-09T10:00:00\.000Z-[a-z0-9]+$/);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual({});
    expect(result.followUpCount).toBe(0);
    expect(result.degradedToUnlocked).toBe(false);
  });

  it("waits for the lock and runs sync after the holder releases", async () => {
    // Lock held by another process initially
    const fake = createFakeFs({
      lockContent: JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" }),
      signalSize: 1,
    });
    const proc = createFakeProcess(9999);

    // Simulate: after first sleep, the holder releases the lock
    let pollCount = 0;
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: {
        ...fake.fs,
        // Intercept unlink to track, but also need to simulate lock release
        writeFile: vi.fn(async (path: string, content: string, options?: { flag?: string }) => {
          if (options?.flag === "wx") {
            pollCount++;
            if (pollCount <= 1) {
              // First attempt: lock still held
              const err = new Error("EEXIST") as NodeJS.ErrnoException;
              err.code = "EEXIST";
              throw err;
            }
            // Second attempt: lock acquired
            fake.state.lockContent = content;
            return;
          }
          return fake.fs.writeFile(path, content, options);
        }),
        readFile: vi.fn(async (path: string) => {
          if (path.endsWith("sync.lock")) {
            if (pollCount === 0) {
              return JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" });
            }
            // After first poll the holder is gone
            const err = new Error("ENOENT") as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw err;
          }
          return fake.fs.readFile(path);
        }),
        unlink: vi.fn(async () => {}),
      } satisfies FsOps,
      process: proc,
      lockTimeoutMs: 10000,
    });

    expect(fake.state.appendCalls).toBe(1);
    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.waitedForLock).toBe(true);
    expect(result.skippedSync).toBe(false);
    expect(result.cycles).toHaveLength(1);
    expect(result.degradedToUnlocked).toBe(false);
  });

  it("skips sync for a waiter when a previous follow-up already consumed the signal", async () => {
    // Lock held by another process initially
    const fake = createFakeFs({
      lockContent: JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" }),
      signalSize: 0,
    });

    // Simulate: lock becomes available after one poll, but the holder's
    // follow-up already consumed the signal (size resets to 0).
    let wxCallCount = 0;
    const overrideFs: FsOps = {
      ...fake.fs,
      writeFile: vi.fn(async (path: string, content: string, options?: { flag?: string }) => {
        if (options?.flag === "wx") {
          wxCallCount++;
          if (wxCallCount <= 1) {
            const err = new Error("EEXIST") as NodeJS.ErrnoException;
            err.code = "EEXIST";
            throw err;
          }
          fake.state.lockContent = content;
          // Simulate: the previous holder's follow-up consumed the signal
          fake.state.signalSize = 0;
          return;
        }
        return fake.fs.writeFile(path, content, options);
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith("sync.lock")) {
          if (wxCallCount <= 1) {
            return JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" });
          }
          if (fake.state.lockContent) return fake.state.lockContent;
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return fake.fs.readFile(path);
      }),
      unlink: vi.fn(async () => { fake.state.lockContent = null; }),
    };

    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: overrideFs,
      process: createFakeProcess(9999),
      lockTimeoutMs: 10000,
    });

    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result.waitedForLock).toBe(true);
    expect(result.skippedSync).toBe(true);
    expect(result.cycles).toHaveLength(0);
  });

  it("runs a dirty follow-up when signal bytes appear during sync", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const executeSyncFn = vi.fn(async () => {
      if (executeSyncFn.mock.calls.length === 1) {
        fake.state.signalSize = 1;
      }
      return {};
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(2);
    expect(result.hadFollowUp).toBe(true);
    expect(result.followUpCount).toBe(1);
    expect(result.cycles).toHaveLength(2);
  });

  it("stops follow-up runs at the configured cap", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const executeSyncFn = vi.fn(async () => {
      fake.state.signalSize = 1;
      return {};
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      maxFollowUps: 2,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(3);
    expect(result.cycles).toHaveLength(3);
    expect(result.followUpCount).toBe(2);
  });

  it("keeps checking dirty state after a sync failure", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const executeSyncFn = vi
      .fn<(_triggers: SyncTrigger[]) => Promise<SyncCycleResult>>()
      .mockImplementationOnce(async () => {
        fake.state.signalSize = 1;
        throw new Error("boom");
      })
      .mockImplementationOnce(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(2);
    expect(result.error).toContain("boom");
    expect(result.hadFollowUp).toBe(true);
    expect(result.cycles).toHaveLength(2);
  });

  it("fails closed when lockfile write throws unexpected error (not EEXIST)", async () => {
    const fake = createFakeFs({ lockContent: null });
    // Override writeFile to throw EACCES on O_EXCL
    const overrideFs: FsOps = {
      ...fake.fs,
      writeFile: vi.fn(async (_path: string, _content: string, options?: { flag?: string }) => {
        if (options?.flag === "wx") {
          const err = new Error("EACCES") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        }
        return fake.fs.writeFile(_path, _content, options);
      }),
    };
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: overrideFs,
      process: createFakeProcess(),
    });

    // Fail-closed: no sync executed, error reported, skippedSync is true
    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result.error).toContain("EACCES");
    expect(result.skippedSync).toBe(true);
    expect(result.degradedToUnlocked).toBe(false);
    expect(result.cycles).toHaveLength(0);
  });

  it("treats a missing signal file as size zero", async () => {
    const fake = createFakeFs({ lockContent: null, signalExists: false });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.hadFollowUp).toBe(false);
  });

  it("captures unexpected signal stat errors and writes error run log", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const statFn = vi.fn(async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      version: "0.8.0",
      fs: { ...fake.fs, stat: statFn },
      process: createFakeProcess(),
    });

    expect(result.error).toContain("denied");
    expect(result.cycles).toHaveLength(0);
  });

  it("returns lock timeout error when lock cannot be acquired in time", async () => {
    // Lock held by alive process — will never release
    const fake = createFakeFs({
      lockContent: JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" }),
      signalSize: 1,
    });
    const executeSyncFn = vi.fn(async () => ({}));

    let elapsed = 0;

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(9999),
      lockTimeoutMs: 10,
      // Use a near-instant now to simulate time passing via waitForLock's internal sleep
    });

    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result.skippedSync).toBe(true);
    expect(result.error).toContain("lock timeout");
    expect(result.cycles).toHaveLength(0);
  });

  it("stores a full SyncCycleResult in cycles[0]", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const fullCycle: SyncCycleResult = {
      tokenSync: { filesScanned: { claude: 3 }, totalDeltas: 10, totalRecords: 5, sources: { claude: 5 } },
      sessionSync: {
        totalSnapshots: 2,
        totalRecords: 2,
        filesScanned: { claude: 1, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
        sources: { claude: 2 },
      },
    };
    const executeSyncFn = vi.fn(async () => fullCycle);

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual(fullCycle);
    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(10);
    expect(result.cycles[0].sessionSync?.totalSnapshots).toBe(2);
  });

  it("collects multiple cycles during follow-ups", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    let callCount = 0;
    const executeSyncFn = vi.fn(async (): Promise<SyncCycleResult> => {
      callCount += 1;
      if (callCount <= 2) fake.state.signalSize = 1;
      return { tokenSync: { filesScanned: { claude: callCount }, totalDeltas: callCount, totalRecords: callCount, sources: {} } };
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      maxFollowUps: 3,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(3);
    expect(result.cycles).toHaveLength(3);
    expect(result.followUpCount).toBe(2);
    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(1);
    expect(result.cycles[1].tokenSync?.totalDeltas).toBe(2);
    expect(result.cycles[2].tokenSync?.totalDeltas).toBe(3);
  });

  it("records an empty cycle when executeSyncFn throws unexpectedly", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const executeSyncFn = vi.fn(async () => {
      throw new Error("unexpected crash");
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual({});
    expect(result.error).toContain("unexpected crash");
  });

  it("preserves a partial success cycle (tokenSync present, sessionSyncError present)", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const partialCycle: SyncCycleResult = {
      tokenSync: { filesScanned: { gemini: 5 }, totalDeltas: 3, totalRecords: 3, sources: { gemini: 3 } },
      sessionSyncError: "session db locked",
    };
    const executeSyncFn = vi.fn(async () => partialCycle);

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(3);
    expect(result.cycles[0].sessionSyncError).toBe("session db locked");
    expect(result.cycles[0].sessionSync).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("releases lockfile after successful run", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: fake.fs,
      process: createFakeProcess(),
    });

    // Lock should be released (unlinked)
    expect(fake.state.lockContent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Run log writing
// ---------------------------------------------------------------------------

describe("run log writing", () => {
  it("writes run log to runs/<runId>.json and last-run.json with correct schema", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => Date.parse("2026-03-10T12:00:00.000Z"),
    });

    const lastRun = extractRunLog(fake.fs);
    expect(lastRun).toBeDefined();

    expect(lastRun!.runId).toBe(result.runId);
    expect(lastRun!.version).toBe("0.8.0");
    expect(lastRun!.triggers).toEqual([createTrigger()]);
    expect(lastRun!.startedAt).toBe("2026-03-10T12:00:00.000Z");
    expect(lastRun!.completedAt).toBe("2026-03-10T12:00:00.000Z");
    expect(lastRun!.durationMs).toBe(0);
    expect(lastRun!.coordination.waitedForLock).toBe(false);
    expect(lastRun!.coordination.skippedSync).toBe(false);
    expect(lastRun!.coordination.hadFollowUp).toBe(false);
    expect(lastRun!.coordination.followUpCount).toBe(0);
    expect(lastRun!.coordination.degradedToUnlocked).toBe(false);
    expect(lastRun!.cycles).toHaveLength(1);
    expect(lastRun!.status).toBe("success");
    expect(lastRun!.error).toBeUndefined();
  });

  it("creates runs/ directory via fs.mkdir", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
    });

    const mkdirCalls = (fake.fs.mkdir as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, { recursive: boolean }][];
    const runsDirCall = mkdirCalls.find(([path]) => path.endsWith("/runs"));
    expect(runsDirCall).toBeDefined();
    expect(runsDirCall![1]).toEqual({ recursive: true });
  });

  it("writes status 'skipped' when sync is skipped (waiter dedup)", async () => {
    // Simulate: lock held, waiter acquires, but signal is empty (consumed by follow-up)
    const fake = createFakeFs({
      lockContent: JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" }),
      signalSize: 0,
    });

    let wxCallCount = 0;
    const overrideFs: FsOps = {
      ...fake.fs,
      writeFile: vi.fn(async (path: string, content: string, options?: { flag?: string }) => {
        if (options?.flag === "wx") {
          wxCallCount++;
          if (wxCallCount <= 1) {
            const err = new Error("EEXIST") as NodeJS.ErrnoException;
            err.code = "EEXIST";
            throw err;
          }
          fake.state.lockContent = content;
          // Simulate: the previous holder's follow-up consumed the signal
          fake.state.signalSize = 0;
          return;
        }
        return fake.fs.writeFile(path, content, options);
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith("sync.lock")) {
          if (wxCallCount <= 1) return JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" });
          if (fake.state.lockContent) return fake.state.lockContent;
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return fake.fs.readFile(path);
      }),
      unlink: vi.fn(async () => { fake.state.lockContent = null; }),
    };

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      version: "0.8.0",
      fs: overrideFs,
      process: createFakeProcess(9999),
      lockTimeoutMs: 10000,
    });

    const log = extractRunLog(overrideFs);
    expect(log).toBeDefined();
    expect(log!.status).toBe("skipped");
    expect(log!.coordination.skippedSync).toBe(true);
  });

  it("writes status 'error' when sync throws", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => {
        throw new Error("db gone");
      }),
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
    });

    const log = extractRunLog(fake.fs);
    expect(log).toBeDefined();
    expect(log!.status).toBe("error");
    expect(log!.error).toContain("db gone");
  });

  it("writes status 'skipped' with error on lock timeout", async () => {
    const fake = createFakeFs({
      lockContent: JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" }),
      signalSize: 1,
    });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(9999),
      lockTimeoutMs: 10,
    });

    const log = extractRunLog(fake.fs);
    expect(log).toBeDefined();
    expect(log!.status).toBe("skipped");
    expect(log!.error).toContain("lock timeout");
    expect(log!.coordination.skippedSync).toBe(true);
  });

  it("writes multiple cycles in run log on follow-up", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const executeSyncFn = vi.fn(async () => {
      if (executeSyncFn.mock.calls.length === 1) {
        fake.state.signalSize = 1;
      }
      return {};
    });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
    });

    const log = extractRunLog(fake.fs);
    expect(log).toBeDefined();
    expect(log!.cycles).toHaveLength(2);
    expect(log!.coordination.hadFollowUp).toBe(true);
    expect(log!.coordination.followUpCount).toBe(1);
  });

  it("writes status 'partial' for partial success cycle", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const partialCycle: SyncCycleResult = {
      tokenSync: { filesScanned: { claude: 2 }, totalDeltas: 1, totalRecords: 1, sources: {} },
      sessionSyncError: "session db locked",
    };

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => partialCycle),
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
    });

    const log = extractRunLog(fake.fs);
    expect(log).toBeDefined();
    expect(log!.status).toBe("partial");
    expect(log!.cycles[0].tokenSync?.totalDeltas).toBe(1);
    expect(log!.cycles[0].sessionSyncError).toBe("session db locked");
  });

  it("returns normally when run log write fails (non-fatal)", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const originalWriteFile = fake.fs.writeFile;
    fake.fs.writeFile = vi.fn(async (path: string, content: string, options?: { flag?: string }) => {
      if (options?.flag === "wx") {
        // Let lock acquisition through
        return originalWriteFile(path, content, options);
      }
      // Let signal truncation through but fail on run log writes
      if (path.endsWith(".json")) {
        throw new Error("disk full");
      }
      return originalWriteFile(path, content, options);
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
    });

    expect(result.runId).toBeDefined();
    expect(result.cycles).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  it("uses 'unknown' as version when not provided", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: fake.fs,
      process: createFakeProcess(),
    });

    const log = extractRunLog(fake.fs);
    expect(log).toBeDefined();
    expect(log!.version).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

describe("cooldown", () => {
  /** Build a minimal last-run.json payload */
  function makeLastRun(status: string, completedAt: string): string {
    return JSON.stringify({ status, completedAt });
  }

  it("skips sync when last successful run is within cooldown window", async () => {
    const NOW = Date.parse("2026-03-10T12:05:00.000Z");
    const LAST_SUCCESS = "2026-03-10T12:03:00.000Z"; // 2 min ago

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 1,
      lastRunContent: makeLastRun("success", LAST_SUCCESS),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 300_000, // 5 min
    });

    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result.skippedSync).toBe(true);
    expect(result.skippedReason).toBe("cooldown");
    expect(result.cooldownRemainingMs).toBe(180_000); // 5min - 2min = 3min
    expect(result.cycles).toHaveLength(0);
  });

  it("runs sync when cooldown has expired", async () => {
    const NOW = Date.parse("2026-03-10T12:10:00.000Z");
    const LAST_SUCCESS = "2026-03-10T12:03:00.000Z"; // 7 min ago

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 0,
      lastRunContent: makeLastRun("success", LAST_SUCCESS),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 300_000,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(false);
    expect(result.skippedReason).toBeUndefined();
    expect(result.cooldownRemainingMs).toBeUndefined();
  });

  it("does not count error runs for cooldown — sync runs after a recent error", async () => {
    const NOW = Date.parse("2026-03-10T12:05:00.000Z");
    const LAST_ERROR = "2026-03-10T12:04:00.000Z"; // 1 min ago, but error

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 0,
      lastRunContent: makeLastRun("error", LAST_ERROR),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 300_000,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(false);
  });

  it("runs sync when no last-run.json exists (first run ever)", async () => {
    const fake = createFakeFs({
      lockContent: null,
      signalSize: 0,
      lastRunContent: null, // no file
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      cooldownMs: 300_000,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(false);
  });

  it("runs sync when last-run.json is corrupted", async () => {
    const fake = createFakeFs({
      lockContent: null,
      signalSize: 0,
      lastRunContent: "not valid json {{{",
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      cooldownMs: 300_000,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(false);
  });

  it("always runs when cooldownMs is 0 (disabled)", async () => {
    const NOW = Date.parse("2026-03-10T12:05:00.000Z");
    const LAST_SUCCESS = "2026-03-10T12:04:59.000Z"; // 1 second ago

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 0,
      lastRunContent: makeLastRun("success", LAST_SUCCESS),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 0,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(false);
  });

  it("preserves signal file on cooldown skip (does not truncate)", async () => {
    const NOW = Date.parse("2026-03-10T12:05:00.000Z");
    const LAST_SUCCESS = "2026-03-10T12:03:00.000Z";

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 5,
      lastRunContent: makeLastRun("success", LAST_SUCCESS),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 300_000,
    });

    // Signal truncation writes empty string to notify.signal.
    // Verify it was never called — only run log writes should have happened.
    const writeCalls = (fake.fs.writeFile as ReturnType<typeof vi.fn>).mock.calls as [string, string, unknown?][];
    const signalTruncateCalls = writeCalls.filter(
      ([path, content]) => path.endsWith("notify.signal") && content === "",
    );
    expect(signalTruncateCalls).toHaveLength(0);
  });

  it("writes run log with skippedReason 'cooldown' on cooldown skip", async () => {
    const NOW = Date.parse("2026-03-10T12:05:00.000Z");
    const LAST_SUCCESS = "2026-03-10T12:03:00.000Z";

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 1,
      lastRunContent: makeLastRun("success", LAST_SUCCESS),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      version: "0.9.0",
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 300_000,
    });

    const log = extractRunLog(fake.fs);
    expect(log).toBeDefined();
    expect(log!.status).toBe("skipped");
    expect(log!.coordination.skippedSync).toBe(true);
    expect(log!.coordination.skippedReason).toBe("cooldown");
  });

  it("does not count skipped runs for cooldown", async () => {
    const NOW = Date.parse("2026-03-10T12:05:00.000Z");
    const LAST_SKIPPED = "2026-03-10T12:04:00.000Z"; // 1 min ago, but skipped

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 0,
      lastRunContent: makeLastRun("skipped", LAST_SKIPPED),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 300_000,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(false);
  });

  it("does not apply cooldown when cooldownMs is not set (defaults to no cooldown)", async () => {
    const NOW = Date.parse("2026-03-10T12:05:00.000Z");
    const LAST_SUCCESS = "2026-03-10T12:04:59.000Z"; // 1 second ago

    const fake = createFakeFs({
      lockContent: null,
      signalSize: 0,
      lastRunContent: makeLastRun("success", LAST_SUCCESS),
    });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      // cooldownMs not set — should default to no cooldown
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(false);
  });
});

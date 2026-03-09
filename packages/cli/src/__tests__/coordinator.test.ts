import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncTrigger } from "@pew/core";
import { coordinatedSync } from "../notifier/coordinator.js";

interface FakeLockHandle {
  close: ReturnType<typeof vi.fn>;
  lock: ReturnType<typeof vi.fn>;
}

interface FakeFsState {
  signalSize: number;
  appendCalls: number;
  truncateCalls: number;
  closed: number;
  mkdirCalls: number;
  signalExists: boolean;
}

function createTrigger(): SyncTrigger {
  return { kind: "notify", source: "codex", fileHint: "/tmp/rollout.jsonl" };
}

function createFakeFs(handle: FakeLockHandle, state?: Partial<FakeFsState>) {
  const fakeState: FakeFsState = {
    signalSize: 0,
    appendCalls: 0,
    truncateCalls: 0,
    closed: 0,
    mkdirCalls: 0,
    signalExists: true,
    ...state,
  };

  return {
    state: fakeState,
    fs: {
      open: vi.fn(async () => handle),
      stat: vi.fn(async () => {
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
      writeFile: vi.fn(async (_path: string, content: string) => {
        fakeState.signalExists = true;
        fakeState.truncateCalls += 1;
        fakeState.signalSize = Buffer.byteLength(content);
      }),
      mkdir: vi.fn(async () => {
        fakeState.mkdirCalls += 1;
      }),
    },
  };
}

function createHandle(lockImpl: FakeLockHandle["lock"]): FakeLockHandle {
  return {
    lock: lockImpl,
    close: vi.fn(async () => {}),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("coordinatedSync", () => {
  it("runs a single sync when the lock is immediately available", async () => {
    const events: string[] = [];
    const handle = createHandle(
      vi.fn(async (_mode?: string, opts?: { nonBlocking?: boolean }) => {
        events.push(opts?.nonBlocking ? "lock-nb" : "lock-block");
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {
      events.push("sync");
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      now: () => Date.parse("2026-03-09T10:00:00.000Z"),
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(fake.state.truncateCalls).toBe(1);
    expect(events).toEqual(["lock-nb", "sync"]);
    expect(result.waitedForLock).toBe(false);
    expect(result.skippedSync).toBe(false);
    expect(result.runId).toMatch(/^2026-03-09T10:00:00\.000Z-[a-z0-9]+$/);
  });

  it("waits for the lock and runs sync after appending a signal", async () => {
    const busyErr = new Error("busy") as NodeJS.ErrnoException;
    busyErr.code = "EAGAIN";
    const handle = createHandle(
      vi.fn(async (_mode?: string, opts?: { nonBlocking?: boolean }) => {
        if (opts?.nonBlocking) throw busyErr;
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {});

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(fake.state.appendCalls).toBe(1);
    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.waitedForLock).toBe(true);
    expect(result.skippedSync).toBe(false);
  });

  it("skips sync for a waiter when a previous follow-up already consumed the signal", async () => {
    const busyErr = new Error("busy") as NodeJS.ErrnoException;
    busyErr.code = "EAGAIN";
    let fakeState: FakeFsState | null = null;
    const handle = createHandle(
      vi.fn(async (_mode?: string, opts?: { nonBlocking?: boolean }) => {
        if (opts?.nonBlocking) throw busyErr;
        if (fakeState) fakeState.signalSize = 0;
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 0 });
    fakeState = fake.state;
    const executeSyncFn = vi.fn(async () => {});

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result.waitedForLock).toBe(true);
    expect(result.skippedSync).toBe(true);
  });

  it("runs a dirty follow-up when signal bytes appear during sync", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {
      if (executeSyncFn.mock.calls.length === 1) {
        fake.state.signalSize = 1;
      }
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(2);
    expect(result.hadFollowUp).toBe(true);
    expect(fake.state.truncateCalls).toBe(2);
  });

  it("stops follow-up runs at the configured cap", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {
      fake.state.signalSize = 1;
    });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      maxFollowUps: 2,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(3);
  });

  it("keeps checking dirty state after a sync failure", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi
      .fn<(_triggers: SyncTrigger[]) => Promise<void>>()
      .mockImplementationOnce(async () => {
        fake.state.signalSize = 1;
        throw new Error("boom");
      })
      .mockImplementationOnce(async () => {});

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(2);
    expect(result.error).toContain("boom");
    expect(result.hadFollowUp).toBe(true);
  });

  it("degrades to an unlocked sync when lock API fails unexpectedly", async () => {
    const handle = createHandle(
      vi.fn(async () => {
        throw new Error("lock unsupported");
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {});

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.waitedForLock).toBe(false);
    expect(result.skippedSync).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("times out while waiting for a blocking lock and closes the file handle", async () => {
    const busyErr = new Error("busy") as NodeJS.ErrnoException;
    busyErr.code = "EAGAIN";
    const handle = createHandle(
      vi.fn((_mode?: string, opts?: { nonBlocking?: boolean }) => {
        if (opts?.nonBlocking) return Promise.reject(busyErr);
        return new Promise<void>(() => {});
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {});

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      lockTimeoutMs: 10,
    });

    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(result.skippedSync).toBe(true);
    expect(result.error).toContain("lock timeout");
  });
});

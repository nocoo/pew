import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncCycleResult, SyncTrigger } from "@pew/core";
import { coordinatedSync } from "../notifier/coordinator.js";

interface FakeLockHandle {
  close: ReturnType<typeof vi.fn>;
  lock?: ReturnType<typeof vi.fn>;
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
      return {};
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
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual({});
    expect(result.followUpCount).toBe(0);
    expect(result.degradedToUnlocked).toBe(false);
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
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(fake.state.appendCalls).toBe(1);
    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.waitedForLock).toBe(true);
    expect(result.skippedSync).toBe(false);
    expect(result.cycles).toHaveLength(1);
    expect(result.followUpCount).toBe(0);
    expect(result.degradedToUnlocked).toBe(false);
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
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result.waitedForLock).toBe(true);
    expect(result.skippedSync).toBe(true);
    expect(result.cycles).toHaveLength(0);
    expect(result.followUpCount).toBe(0);
  });

  it("runs a dirty follow-up when signal bytes appear during sync", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
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
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(2);
    expect(result.hadFollowUp).toBe(true);
    expect(result.followUpCount).toBe(1);
    expect(result.cycles).toHaveLength(2);
    expect(fake.state.truncateCalls).toBe(2);
  });

  it("stops follow-up runs at the configured cap", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {
      fake.state.signalSize = 1;
      return {};
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
      maxFollowUps: 2,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(3);
    expect(result.cycles).toHaveLength(3);
    expect(result.followUpCount).toBe(2);
  });

  it("keeps checking dirty state after a sync failure", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
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
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(2);
    expect(result.error).toContain("boom");
    expect(result.hadFollowUp).toBe(true);
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[0]).toEqual({});
    expect(result.cycles[1]).toEqual({});
  });

  it("degrades to an unlocked sync when lock API fails unexpectedly", async () => {
    const handle = createHandle(
      vi.fn(async () => {
        throw new Error("lock unsupported");
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.waitedForLock).toBe(false);
    expect(result.skippedSync).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.degradedToUnlocked).toBe(true);
    expect(result.cycles).toHaveLength(1);
  });

  it("degrades to an unlocked sync when the runtime file handle has no lock method", async () => {
    const handle: FakeLockHandle = {
      close: vi.fn(async () => {}),
    };
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(result.waitedForLock).toBe(false);
    expect(result.skippedSync).toBe(false);
    expect(result.degradedToUnlocked).toBe(true);
    expect(result.cycles).toHaveLength(1);
  });

  it("degrades to an unlocked sync when fs.open fails before a handle is created", async () => {
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: {
        ...createFakeFs(createHandle(vi.fn(async () => {}))).fs,
        open: vi.fn(async () => {
          throw new Error("open failed");
        }),
      },
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.error).toBeUndefined();
    expect(result.degradedToUnlocked).toBe(true);
    expect(result.cycles).toHaveLength(1);
  });

  it("treats a missing signal file as size zero", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalExists: false });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result.hadFollowUp).toBe(false);
  });

  it("rethrows unexpected signal stat errors while holding the lock", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    fake.fs.stat = vi.fn(async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });

    await expect(
      coordinatedSync(createTrigger(), {
        stateDir: "/tmp/pew",
        executeSyncFn: vi.fn(async () => ({})),
        fs: fake.fs,
      }),
    ).rejects.toThrow("denied");
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("treats EWOULDBLOCK like EAGAIN", async () => {
    const busyErr = new Error("busy") as NodeJS.ErrnoException;
    busyErr.code = "EWOULDBLOCK";
    const handle = createHandle(
      vi.fn(async (_mode?: string, opts?: { nonBlocking?: boolean }) => {
        if (opts?.nonBlocking) throw busyErr;
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(result.waitedForLock).toBe(true);
    expect(executeSyncFn).toHaveBeenCalledTimes(1);
  });

  it("returns sync errors in unlocked mode", async () => {
    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => {
        throw new Error("sync failed");
      }),
      fs: {
        ...createFakeFs(createHandle(vi.fn(async () => {}))).fs,
        open: vi.fn(async () => {
          throw new Error("open failed");
        }),
      },
    });

    expect(result.error).toContain("sync failed");
    expect(result.degradedToUnlocked).toBe(true);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual({});
  });

  it("closes the lock handle after a successful run", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 0 });

    await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: fake.fs,
    });

    expect(handle.close).toHaveBeenCalledTimes(1);
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
    const executeSyncFn = vi.fn(async () => ({}));

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
    expect(result.cycles).toHaveLength(0);
  });

  it("returns a timeout-style error when the blocking lock promise rejects", async () => {
    const busyErr = new Error("busy") as NodeJS.ErrnoException;
    busyErr.code = "EAGAIN";
    const handle = createHandle(
      vi.fn(async (_mode?: string, opts?: { nonBlocking?: boolean }) => {
        if (opts?.nonBlocking) throw busyErr;
        throw new Error("lock failed");
      }),
    );
    const fake = createFakeFs(handle, { signalSize: 1 });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: fake.fs,
    });

    expect(result.skippedSync).toBe(true);
    expect(result.error).toContain("lock timeout");
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(result.cycles).toHaveLength(0);
  });

  it("stores a full SyncCycleResult in cycles[0]", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    const fullCycle: SyncCycleResult = {
      tokenSync: { filesScanned: { claude: 3 }, totalDeltas: 10, totalRecords: 5, sources: { claude: 5 } },
      sessionSync: {
        totalSnapshots: 2,
        totalRecords: 2,
        filesScanned: { claude: 1, codex: 0, gemini: 0, opencode: 0, openclaw: 0 },
        sources: { claude: 2 },
      },
    };
    const executeSyncFn = vi.fn(async () => fullCycle);

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual(fullCycle);
    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(10);
    expect(result.cycles[0].sessionSync?.totalSnapshots).toBe(2);
  });

  it("collects multiple cycles during follow-ups", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
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
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    const executeSyncFn = vi.fn(async () => {
      throw new Error("unexpected crash");
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toEqual({});
    expect(result.error).toContain("unexpected crash");
  });

  it("preserves a partial success cycle (tokenSync present, sessionSyncError present)", async () => {
    const handle = createHandle(vi.fn(async () => {}));
    const fake = createFakeFs(handle, { signalSize: 1 });
    const partialCycle: SyncCycleResult = {
      tokenSync: { filesScanned: { gemini: 5 }, totalDeltas: 3, totalRecords: 3, sources: { gemini: 3 } },
      sessionSyncError: "session db locked",
    };
    const executeSyncFn = vi.fn(async () => partialCycle);

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs: fake.fs,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(3);
    expect(result.cycles[0].sessionSyncError).toBe("session db locked");
    expect(result.cycles[0].sessionSync).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

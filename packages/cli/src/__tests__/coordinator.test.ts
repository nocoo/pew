import { describe, expect, it, vi } from "vitest";
import type { RunLogEntry, SyncCycleResult, SyncTrigger } from "@pew/core";
import { coordinatedSync, type FsOps } from "../notifier/coordinator.js";
import type { ProcessOps } from "../notifier/lockfile.js";

interface FakeFsState {
  signalSize: number;
  appendCalls: number;
  truncateCalls: number;
  mkdirCalls: number;
  signalExists: boolean;
  lockContent: string | null;
  lastSuccessAt: string | null;
}

function createTrigger(): SyncTrigger {
  return { kind: "notify", source: "codex", fileHint: "/tmp/rollout.jsonl" };
}

function createFakeProcess(pid = 9999): ProcessOps {
  return { pid, kill: () => true };
}

function createFakeFs(state?: Partial<FakeFsState>) {
  const fakeState: FakeFsState = {
    signalSize: 0,
    appendCalls: 0,
    truncateCalls: 0,
    mkdirCalls: 0,
    signalExists: true,
    lockContent: null,
    lastSuccessAt: null,
    ...state,
  };

  const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  const fs: FsOps = {
    stat: vi.fn(async () => {
      if (!fakeState.signalExists) throw enoent();
      return { size: fakeState.signalSize };
    }),
    appendFile: vi.fn(async (_path: string, content: string) => {
      fakeState.signalExists = true;
      fakeState.appendCalls += 1;
      fakeState.signalSize += Buffer.byteLength(content);
    }),
    writeFile: vi.fn(async (_path: string, content: string, options?: { flag?: string }) => {
      if (options?.flag === "wx") {
        if (fakeState.lockContent !== null)
          throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        fakeState.lockContent = content;
        return;
      }
      fakeState.signalExists = true;
      fakeState.truncateCalls += 1;
      fakeState.signalSize = Buffer.byteLength(content);
    }),
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith("sync.lock")) {
        if (fakeState.lockContent === null) throw enoent();
        return fakeState.lockContent;
      }
      if (path.endsWith("last-success.json")) {
        if (fakeState.lastSuccessAt === null) throw enoent();
        return fakeState.lastSuccessAt;
      }
      throw new Error(`readFile: unexpected path ${path}`);
    }),
    unlink: vi.fn(async (path: string) => {
      if (path.endsWith("sync.lock")) {
        fakeState.lockContent = null;
        return;
      }
      throw new Error(`unlink: unexpected path ${path}`);
    }),
    mkdir: vi.fn(async () => {
      fakeState.mkdirCalls += 1;
    }),
  };

  return { state: fakeState, fs };
}

function createContendedFs(opts: {
  consumeSignalOnRelease?: boolean;
  deleteSignalAfterWait?: boolean;
}) {
  const holderLock = JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" });
  const fake = createFakeFs({
    lockContent: holderLock,
    signalSize: opts.consumeSignalOnRelease ? 0 : 1,
  });
  let wxCallCount = 0;
  const fs: FsOps = {
    ...fake.fs,
    stat: vi.fn(async (path: string) => {
      if (opts.deleteSignalAfterWait && path.endsWith("notify.signal")) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return fake.fs.stat(path);
    }),
    writeFile: vi.fn(async (path: string, content: string, options?: { flag?: string }) => {
      if (options?.flag === "wx") {
        wxCallCount++;
        if (wxCallCount <= 1) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        fake.state.lockContent = content;
        if (opts.consumeSignalOnRelease) fake.state.signalSize = 0;
        return;
      }
      return fake.fs.writeFile(path, content, options);
    }),
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith("sync.lock")) {
        if (wxCallCount <= 1) return holderLock;
        if (fake.state.lockContent) return fake.state.lockContent;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return fake.fs.readFile(path);
    }),
    unlink: vi.fn(async () => {
      fake.state.lockContent = null;
    }),
  };
  return { state: fake.state, fs };
}

function extractRunLog(fs: FsOps): RunLogEntry | undefined {
  const calls = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls as [
    string,
    string,
    unknown?,
  ][];
  const logCall = calls.find(([path]) => path.endsWith("last-run.json"));
  return logCall ? JSON.parse(logCall[1]) : undefined;
}

describe("coordinatedSync", () => {
  it("runs a single sync immediately, writes run log & runs dir, and releases lock", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    const fullCycle: SyncCycleResult = {
      tokenSync: {
        filesScanned: { claude: 3 },
        totalDeltas: 10,
        totalRecords: 5,
        sources: { claude: 5 },
      },
      sessionSync: {
        totalSnapshots: 2,
        totalRecords: 2,
        filesScanned: {
          claude: 1,
          codex: 0,
          gemini: 0,
          opencode: 0,
          openclaw: 0,
          vscodeCopilot: 0,
        },
        sources: { claude: 2 },
      },
    };
    const executeSyncFn = vi.fn(async () => fullCycle);

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => Date.parse("2026-03-10T12:00:00.000Z"),
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      waitedForLock: false,
      skippedSync: false,
      followUpCount: 0,
      degradedToUnlocked: false,
    });
    expect(result.runId).toMatch(/^2026-03-10T12:00:00\.000Z-[a-z0-9]+$/);
    expect(result.cycles).toEqual([fullCycle]);
    expect(fake.state.lockContent).toBeNull();

    const mkdirCalls = (fake.fs.mkdir as ReturnType<typeof vi.fn>).mock.calls as unknown as [
      string,
      { recursive: boolean },
    ][];
    expect(mkdirCalls.find(([p]) => p.endsWith("/runs"))?.[1]).toEqual({ recursive: true });

    const log = extractRunLog(fake.fs)!;
    expect(log).toMatchObject({
      runId: result.runId,
      version: "0.8.0",
      triggers: [createTrigger()],
      startedAt: "2026-03-10T12:00:00.000Z",
      completedAt: "2026-03-10T12:00:00.000Z",
      durationMs: 0,
      status: "success",
    });
    expect(log.coordination).toMatchObject({
      waitedForLock: false,
      skippedSync: false,
      hadFollowUp: false,
      followUpCount: 0,
      degradedToUnlocked: false,
    });
  });

  it("waits for the lock and runs sync after the holder releases", async () => {
    const { state, fs } = createContendedFs({});
    const executeSyncFn = vi.fn(async () => ({}));
    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      fs,
      process: createFakeProcess(),
      lockTimeoutMs: 10000,
    });
    expect(state.appendCalls).toBe(1);
    expect(executeSyncFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      waitedForLock: true,
      skippedSync: false,
      degradedToUnlocked: false,
    });
  });

  it.each([
    { label: "signal consumed", opts: { consumeSignalOnRelease: true } },
    { label: "signal missing ENOENT", opts: { deleteSignalAfterWait: true } },
  ])("skips sync for waiter when $label and logs status 'skipped'", async ({ opts }) => {
    const { fs } = createContendedFs(opts);
    const executeSyncFn = vi.fn(async () => ({}));
    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      version: "0.8.0",
      fs,
      process: createFakeProcess(),
      lockTimeoutMs: 10000,
    });
    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ waitedForLock: true, skippedSync: true, cycles: [] });
    expect(extractRunLog(fs)).toMatchObject({
      status: "skipped",
      coordination: { skippedSync: true },
    });
  });

  it("runs dirty follow-ups up to maxFollowUps, keeps checking after failure, and logs cycles", async () => {
    const fake = createFakeFs({ lockContent: null, signalSize: 0 });
    let callCount = 0;
    const executeSyncFn = vi.fn(async (): Promise<SyncCycleResult> => {
      callCount += 1;
      fake.state.signalSize = 1;
      if (callCount === 1) throw new Error("boom");
      return {
        tokenSync: {
          filesScanned: { claude: callCount },
          totalDeltas: callCount,
          totalRecords: callCount,
          sources: {},
        },
      };
    });

    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      version: "0.8.0",
      fs: fake.fs,
      process: createFakeProcess(),
      maxFollowUps: 2,
    });

    expect(executeSyncFn).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ hadFollowUp: true, followUpCount: 2 });
    expect(result.error).toContain("boom");
    expect(result.cycles).toHaveLength(3);
    expect(result.cycles[0]).toEqual({});
    expect(result.cycles[1]?.tokenSync?.totalDeltas).toBe(2);
    expect(extractRunLog(fake.fs)?.cycles).toHaveLength(3);
  });

  it("fails closed on unexpected lock error, captures signal stat error, and handles lock timeout", async () => {
    // 1) EACCES on O_EXCL lockfile
    const fakeAcc = createFakeFs({ lockContent: null });
    const eaccesFs: FsOps = {
      ...fakeAcc.fs,
      writeFile: vi.fn(async (p: string, c: string, o?: { flag?: string }) => {
        if (o?.flag === "wx") throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        return fakeAcc.fs.writeFile(p, c, o);
      }),
    };
    const rAcc = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: eaccesFs,
      process: createFakeProcess(),
    });
    expect(rAcc).toMatchObject({ skippedSync: true, degradedToUnlocked: false, cycles: [] });
    expect(rAcc.error).toContain("EACCES");

    // 2) Signal stat error
    const fakeStat = createFakeFs({ lockContent: null });
    const rStat = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: {
        ...fakeStat.fs,
        stat: vi.fn(async () => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }),
      },
      process: createFakeProcess(),
    });
    expect(rStat.error).toContain("denied");
    expect(extractRunLog(fakeStat.fs)?.status).toBe("error");

    // 3) Lock timeout
    const fakeTimeout = createFakeFs({
      lockContent: JSON.stringify({ pid: 7777, startedAt: "2026-03-09T10:00:00Z" }),
      signalSize: 1,
    });
    const rTo = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: fakeTimeout.fs,
      process: createFakeProcess(),
      lockTimeoutMs: 10,
    });
    expect(rTo).toMatchObject({ skippedSync: true, cycles: [] });
    expect(rTo.error).toContain("lock timeout");
    expect(extractRunLog(fakeTimeout.fs)).toMatchObject({
      status: "skipped",
      error: expect.stringContaining("lock timeout"),
    });
  });

  it("treats missing signal file as size zero and handles partial/error/missing-version/failed run logs", async () => {
    const fakeMissing = createFakeFs({ lockContent: null, signalExists: false });
    const rMissing = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: fakeMissing.fs,
      process: createFakeProcess(),
    });
    expect(rMissing.hadFollowUp).toBe(false);
    expect(extractRunLog(fakeMissing.fs)?.version).toBe("unknown");

    // Partial cycle
    const fakePartial = createFakeFs({ lockContent: null, signalSize: 0 });
    const partialCycle: SyncCycleResult = {
      tokenSync: {
        filesScanned: { gemini: 5 },
        totalDeltas: 3,
        totalRecords: 3,
        sources: { gemini: 3 },
      },
      sessionSyncError: "session db locked",
    };
    const rPartial = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => partialCycle),
      version: "0.8.0",
      fs: fakePartial.fs,
      process: createFakeProcess(),
    });
    expect(rPartial.error).toBeUndefined();
    expect(extractRunLog(fakePartial.fs)).toMatchObject({ status: "partial" });

    // Non-fatal run log write failure
    const fakeLogFail = createFakeFs({ lockContent: null, signalSize: 0 });
    const origWrite = fakeLogFail.fs.writeFile;
    fakeLogFail.fs.writeFile = vi.fn(async (p: string, c: string, o?: { flag?: string }) => {
      if (o?.flag !== "wx" && p.endsWith(".json")) throw new Error("disk full");
      return origWrite(p, c, o);
    });
    const rLogFail = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      fs: fakeLogFail.fs,
      process: createFakeProcess(),
    });
    expect(rLogFail.error).toBeUndefined();
    expect(rLogFail.cycles).toHaveLength(1);
  });
});

describe("cooldown", () => {
  const NOW = Date.parse("2026-03-10T12:05:00.000Z");

  it("skips within cooldown window without truncating signal or overwriting last-success.json", async () => {
    const fake = createFakeFs({
      lockContent: null,
      signalSize: 5,
      lastSuccessAt: "2026-03-10T12:03:00.000Z",
    });
    const executeSyncFn = vi.fn(async () => ({}));
    const result = await coordinatedSync(createTrigger(), {
      stateDir: "/tmp/pew",
      executeSyncFn,
      version: "0.9.0",
      fs: fake.fs,
      process: createFakeProcess(),
      now: () => NOW,
      cooldownMs: 300_000,
    });

    expect(executeSyncFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      skippedSync: true,
      skippedReason: "cooldown",
      cooldownRemainingMs: 180_000,
      cycles: [],
    });
    expect(extractRunLog(fake.fs)).toMatchObject({
      status: "skipped",
      coordination: { skippedSync: true, skippedReason: "cooldown" },
    });

    const writes = (fake.fs.writeFile as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    expect(writes.some(([p, c]) => p.endsWith("notify.signal") && c === "")).toBe(false);
    expect(writes.some(([p]) => p.endsWith("last-success.json"))).toBe(false);
  });

  it.each([
    { label: "expired", lastSuccessAt: "2026-03-10T11:58:00.000Z", cooldownMs: 300_000 },
    { label: "first run (missing file)", lastSuccessAt: null, cooldownMs: 300_000 },
    {
      label: "corrupted timestamp",
      lastSuccessAt: "not a valid ISO date {{{",
      cooldownMs: 300_000,
    },
    { label: "cooldownMs=0", lastSuccessAt: "2026-03-10T12:04:59.000Z", cooldownMs: 0 },
    {
      label: "cooldownMs omitted",
      lastSuccessAt: "2026-03-10T12:04:59.000Z",
      cooldownMs: undefined,
    },
  ])(
    "runs sync and writes last-success.json when $label",
    async ({ lastSuccessAt, cooldownMs }) => {
      const fake = createFakeFs({ lockContent: null, signalSize: 0, lastSuccessAt });
      const executeSyncFn = vi.fn(async () => ({}));
      const result = await coordinatedSync(createTrigger(), {
        stateDir: "/tmp/pew",
        executeSyncFn,
        fs: fake.fs,
        process: createFakeProcess(),
        now: () => NOW,
        ...(cooldownMs !== undefined ? { cooldownMs } : {}),
      });

      expect(executeSyncFn).toHaveBeenCalledTimes(1);
      expect(result.skippedSync).toBe(false);
      expect(result.skippedReason).toBeUndefined();
      const writes = (fake.fs.writeFile as ReturnType<typeof vi.fn>).mock.calls as [
        string,
        string,
      ][];
      const successWrite = writes.find(([p]) => p.endsWith("last-success.json"));
      if (cooldownMs && cooldownMs > 0) {
        expect(new Date(successWrite![1]).getTime()).toBe(NOW);
      }
    },
  );
});

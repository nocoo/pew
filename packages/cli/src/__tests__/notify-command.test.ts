import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CoordinatorRunResult, SyncCycleResult, SyncTrigger } from "@pew/core";

// Mock the real sync modules so the default executeSyncFn can be tested
vi.mock("../commands/sync.js", () => ({
  executeSync: vi.fn(async () => ({
    totalDeltas: 7,
    totalRecords: 4,
    filesScanned: { claude: 3, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    sources: { claude: 4, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
  })),
}));

vi.mock("../commands/session-sync.js", () => ({
  executeSessionSync: vi.fn(async () => ({
    totalSnapshots: 3,
    totalRecords: 3,
    filesScanned: { claude: 2, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    sources: { claude: 3, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
  })),
}));

import { executeNotify } from "../commands/notify.js";
import { executeSync } from "../commands/sync.js";
import { executeSessionSync } from "../commands/session-sync.js";

function makeResult(overrides: Partial<CoordinatorRunResult> = {}): CoordinatorRunResult {
  return {
    runId: "run-1",
    triggers: [],
    hadFollowUp: false,
    followUpCount: 0,
    waitedForLock: false,
    skippedSync: false,
    degradedToUnlocked: false,
    cycles: [],
    ...overrides,
  };
}

describe("executeNotify", () => {
  it("passes a notify trigger into coordinatedSync", async () => {
    const coordinatedSyncFn = vi.fn<
      (
        trigger: SyncTrigger,
        opts: { executeSyncFn: (triggers: SyncTrigger[]) => Promise<SyncCycleResult>; stateDir: string },
      ) => Promise<CoordinatorRunResult>
    >(async (trigger) =>
      makeResult({ triggers: [trigger] }),
    );

    const result = await executeNotify({
      source: "codex",
      fileHint: "/tmp/rollout.jsonl",
      stateDir: "/tmp/pew",
      coordinatedSyncFn,
      executeSyncFn: vi.fn(async () => ({})),
    });

    expect(coordinatedSyncFn).toHaveBeenCalledTimes(1);
    expect(coordinatedSyncFn.mock.calls[0]?.[0]).toEqual({
      kind: "notify",
      source: "codex",
      fileHint: "/tmp/rollout.jsonl",
    });
    expect(result.runId).toBe("run-1");
  });

  it("delegates to executeSync through the coordinated executor", async () => {
    const executeSyncFn = vi.fn(async (_triggers: SyncTrigger[]) => ({}));

    await executeNotify({
      source: "claude-code",
      stateDir: "/tmp/pew",
      executeSyncFn,
      coordinatedSyncFn: async (trigger, opts) => {
        await opts.executeSyncFn([trigger]);
        return makeResult({ triggers: [trigger] });
      },
    });

    expect(executeSyncFn).toHaveBeenCalledWith([
      { kind: "notify", source: "claude-code", fileHint: null },
    ]);
  });

  it("returns coordinator errors", async () => {
    const result = await executeNotify({
      source: "gemini-cli",
      stateDir: "/tmp/pew",
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn: async (trigger) =>
        makeResult({
          triggers: [trigger],
          waitedForLock: true,
          skippedSync: true,
          error: "lock timeout",
        }),
    });

    expect(result.error).toBe("lock timeout");
    expect(result.skippedSync).toBe(true);
  });

  it("passes version to coordinator options", async () => {
    let capturedVersion: string | undefined;
    const coordinatedSyncFn = vi.fn(async (_trigger: SyncTrigger, opts: { version?: string }) => {
      capturedVersion = opts.version;
      return makeResult();
    });

    await executeNotify({
      source: "codex",
      stateDir: "/tmp/pew",
      version: "0.8.0",
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    expect(capturedVersion).toBe("0.8.0");
  });

  it("custom executeSyncFn result flows through coordinator to final result", async () => {
    const executeSyncFn = vi.fn(async (): Promise<SyncCycleResult> => ({
      tokenSync: { totalDeltas: 5, totalRecords: 3, filesScanned: { claude: 2 }, sources: { claude: 3 } },
      sessionSync: { totalSnapshots: 2, totalRecords: 2, filesScanned: { claude: 1 }, sources: { claude: 2 } },
    }));

    const result = await executeNotify({
      source: "opencode",
      stateDir: "/tmp/pew",
      executeSyncFn,
      coordinatedSyncFn: async (trigger, opts) => {
        const cycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [cycle] });
      },
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(5);
    expect(result.cycles[0].sessionSync?.totalSnapshots).toBe(2);
  });

  it("executeSyncFn returns partial success when session sync fails", async () => {
    const executeSyncFn = vi.fn(async (): Promise<SyncCycleResult> => ({
      tokenSync: { totalDeltas: 3, totalRecords: 2, filesScanned: {}, sources: {} },
      sessionSyncError: "session db locked",
    }));

    const result = await executeNotify({
      source: "claude-code",
      stateDir: "/tmp/pew",
      executeSyncFn,
      coordinatedSyncFn: async (trigger, opts) => {
        const cycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [cycle] });
      },
    });

    expect(result.cycles[0].tokenSync).toBeDefined();
    expect(result.cycles[0].sessionSyncError).toBe("session db locked");
    expect(result.cycles[0].sessionSync).toBeUndefined();
  });

  it("executeSyncFn returns both results on full success", async () => {
    const executeSyncFn = vi.fn(async (): Promise<SyncCycleResult> => ({
      tokenSync: { totalDeltas: 10, totalRecords: 8, filesScanned: { gemini: 4 }, sources: { gemini: 8 } },
      sessionSync: { totalSnapshots: 5, totalRecords: 5, filesScanned: { gemini: 3 }, sources: { gemini: 5 } },
    }));

    const result = await executeNotify({
      source: "gemini-cli",
      stateDir: "/tmp/pew",
      executeSyncFn,
      coordinatedSyncFn: async (trigger, opts) => {
        const cycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [cycle] });
      },
    });

    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(10);
    expect(result.cycles[0].sessionSync?.totalSnapshots).toBe(5);
    expect(result.cycles[0].tokenSyncError).toBeUndefined();
    expect(result.cycles[0].sessionSyncError).toBeUndefined();
  });

  // ===== Default executeSyncFn (exercises the real lambda on lines 29-77) =====

  it("default executeSyncFn calls executeSync and executeSessionSync", async () => {
    vi.mocked(executeSync).mockResolvedValueOnce({
      totalDeltas: 7,
      totalRecords: 4,
      filesScanned: { claude: 3, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 4, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });
    vi.mocked(executeSessionSync).mockResolvedValueOnce({
      totalSnapshots: 3,
      totalRecords: 3,
      filesScanned: { claude: 2, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 3, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });

    let capturedCycle: SyncCycleResult | undefined;
    const result = await executeNotify({
      source: "claude-code",
      stateDir: "/tmp/pew",
      // NO executeSyncFn — uses the default
      coordinatedSyncFn: async (trigger, opts) => {
        capturedCycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [capturedCycle] });
      },
    });

    // Verify both sync functions were called
    expect(executeSync).toHaveBeenCalledTimes(1);
    expect(executeSessionSync).toHaveBeenCalledTimes(1);

    // Verify cycle contains token sync results
    expect(capturedCycle?.tokenSync).toEqual({
      totalDeltas: 7,
      totalRecords: 4,
      filesScanned: { claude: 3, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 4, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });

    // Verify cycle contains session sync results
    expect(capturedCycle?.sessionSync).toEqual({
      totalSnapshots: 3,
      totalRecords: 3,
      filesScanned: { claude: 2, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 3, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });

    expect(result.cycles).toHaveLength(1);
  });

  it("default executeSyncFn captures tokenSyncError when executeSync throws", async () => {
    vi.mocked(executeSync).mockRejectedValueOnce(new Error("cursor corrupted"));
    vi.mocked(executeSessionSync).mockResolvedValueOnce({
      totalSnapshots: 1,
      totalRecords: 1,
      filesScanned: { claude: 1, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 1, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });

    let capturedCycle: SyncCycleResult | undefined;
    await executeNotify({
      source: "opencode",
      stateDir: "/tmp/pew",
      coordinatedSyncFn: async (trigger, opts) => {
        capturedCycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [capturedCycle] });
      },
    });

    expect(capturedCycle?.tokenSyncError).toBe("cursor corrupted");
    expect(capturedCycle?.tokenSync).toBeUndefined();
    // Session sync should still succeed
    expect(capturedCycle?.sessionSync?.totalSnapshots).toBe(1);
    expect(capturedCycle?.sessionSyncError).toBeUndefined();
  });

  it("default executeSyncFn captures sessionSyncError when executeSessionSync throws", async () => {
    vi.mocked(executeSync).mockResolvedValueOnce({
      totalDeltas: 5,
      totalRecords: 3,
      filesScanned: { claude: 2, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 3, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });
    vi.mocked(executeSessionSync).mockRejectedValueOnce(new Error("session db locked"));

    let capturedCycle: SyncCycleResult | undefined;
    await executeNotify({
      source: "gemini-cli",
      stateDir: "/tmp/pew",
      coordinatedSyncFn: async (trigger, opts) => {
        capturedCycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [capturedCycle] });
      },
    });

    expect(capturedCycle?.tokenSync?.totalDeltas).toBe(5);
    expect(capturedCycle?.tokenSyncError).toBeUndefined();
    expect(capturedCycle?.sessionSyncError).toBe("session db locked");
    expect(capturedCycle?.sessionSync).toBeUndefined();
  });

  it("default executeSyncFn captures both errors when both throw", async () => {
    vi.mocked(executeSync).mockRejectedValueOnce(new Error("disk full"));
    vi.mocked(executeSessionSync).mockRejectedValueOnce("non-error rejection");

    let capturedCycle: SyncCycleResult | undefined;
    await executeNotify({
      source: "codex",
      stateDir: "/tmp/pew",
      coordinatedSyncFn: async (trigger, opts) => {
        capturedCycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [capturedCycle] });
      },
    });

    expect(capturedCycle?.tokenSyncError).toBe("disk full");
    expect(capturedCycle?.sessionSyncError).toBe("non-error rejection");
    expect(capturedCycle?.tokenSync).toBeUndefined();
    expect(capturedCycle?.sessionSync).toBeUndefined();
  });

  it("default executeSyncFn passes stateDir and source dirs to executeSync", async () => {
    vi.mocked(executeSync).mockResolvedValueOnce({
      totalDeltas: 0, totalRecords: 0,
      filesScanned: { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });
    vi.mocked(executeSessionSync).mockResolvedValueOnce({
      totalSnapshots: 0, totalRecords: 0,
      filesScanned: { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
      sources: { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 },
    });

    await executeNotify({
      source: "claude-code",
      stateDir: "/tmp/pew-state",
      claudeDir: "/home/.claude",
      geminiDir: "/home/.gemini",
      openCodeMessageDir: "/home/.local/share/opencode/storage/message",
      openCodeDbPath: "/home/.local/share/opencode/opencode.db",
      openclawDir: "/home/.openclaw",
      codexSessionsDir: "/home/.codex/sessions",
      coordinatedSyncFn: async (trigger, opts) => {
        const cycle = await opts.executeSyncFn([trigger]);
        return makeResult({ cycles: [cycle] });
      },
    });

    expect(executeSync).toHaveBeenCalledWith(
      expect.objectContaining({
        stateDir: "/tmp/pew-state",
        claudeDir: "/home/.claude",
        geminiDir: "/home/.gemini",
        openCodeMessageDir: "/home/.local/share/opencode/storage/message",
        openCodeDbPath: "/home/.local/share/opencode/opencode.db",
        openclawDir: "/home/.openclaw",
        codexSessionsDir: "/home/.codex/sessions",
      }),
    );

    expect(executeSessionSync).toHaveBeenCalledWith(
      expect.objectContaining({
        stateDir: "/tmp/pew-state",
        claudeDir: "/home/.claude",
        geminiDir: "/home/.gemini",
        openCodeMessageDir: "/home/.local/share/opencode/storage/message",
        openCodeDbPath: "/home/.local/share/opencode/opencode.db",
        openclawDir: "/home/.openclaw",
        codexSessionsDir: "/home/.codex/sessions",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Trailing-edge guarantee
//
// Uses real timers with very short delays (10 ms) + vi.waitFor() to avoid
// the interaction between fake timers and real filesystem I/O (writeFile
// for trailing.lock uses libuv async I/O that doesn't play well with fake
// timer flushing).
// ---------------------------------------------------------------------------

describe("trailing-edge cooldown sync", () => {
  let tempDir: string;

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    tempDir = await mkdtemp(join(tmpdir(), "pew-notify-test-"));
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(tempDir, { recursive: true, force: true });
  });

  it("schedules trailing sync when cooldown fires", async () => {
    let callCount = 0;
    const coordinatedSyncFn = vi.fn(
      async (_trigger: SyncTrigger, _opts: Record<string, unknown>): Promise<CoordinatorRunResult> => {
        callCount++;
        if (callCount === 1) {
          // First call: cooldown skip
          return makeResult({
            skippedSync: true,
            skippedReason: "cooldown",
            cooldownRemainingMs: 10, // Very short delay for test speed
          });
        }
        // Trailing call: normal run
        return makeResult({ cycles: [{}] });
      },
    );

    const result = await executeNotify({
      source: "claude-code",
      stateDir: tempDir,
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    // First call returns cooldown skip
    expect(result.skippedSync).toBe(true);
    expect(result.skippedReason).toBe("cooldown");
    expect(coordinatedSyncFn).toHaveBeenCalledTimes(1);

    // Wait for trailing sync to fire (real timer, short delay)
    await vi.waitFor(() => {
      expect(coordinatedSyncFn).toHaveBeenCalledTimes(2);
    }, { timeout: 2_000 });
  });

  it("does not schedule trailing sync when cooldown does not fire", async () => {
    const coordinatedSyncFn = vi.fn(
      async (): Promise<CoordinatorRunResult> =>
        makeResult({ cycles: [{}] }),
    );

    await executeNotify({
      source: "claude-code",
      stateDir: tempDir,
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    // Give it some time — no trailing sync should ever fire
    await new Promise((r) => setTimeout(r, 50));
    expect(coordinatedSyncFn).toHaveBeenCalledTimes(1);
  });

  it("does not schedule trailing sync when cooldownRemainingMs is missing", async () => {
    const coordinatedSyncFn = vi.fn(
      async (): Promise<CoordinatorRunResult> =>
        makeResult({
          skippedSync: true,
          skippedReason: "cooldown",
          // cooldownRemainingMs NOT set
        }),
    );

    await executeNotify({
      source: "claude-code",
      stateDir: tempDir,
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(coordinatedSyncFn).toHaveBeenCalledTimes(1);
  });

  it("only one trailing process sleeps — second cooldown skip is a no-op", async () => {
    let callCount = 0;
    const coordinatedSyncFn = vi.fn(
      async (): Promise<CoordinatorRunResult> => {
        callCount++;
        if (callCount <= 2) {
          return makeResult({
            skippedSync: true,
            skippedReason: "cooldown",
            cooldownRemainingMs: 200, // Long enough for second notify to see the lock
          });
        }
        return makeResult({ cycles: [{}] });
      },
    );

    // First notify — acquires trailing.lock
    await executeNotify({
      source: "claude-code",
      stateDir: tempDir,
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    // Allow trailing.lock to be created before second call
    await new Promise((r) => setTimeout(r, 5));

    // Second notify — trailing.lock exists with live PID → no-op
    await executeNotify({
      source: "claude-code",
      stateDir: tempDir,
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    expect(coordinatedSyncFn).toHaveBeenCalledTimes(2); // 2 initial calls

    // Wait for trailing sync — only one should fire
    await vi.waitFor(() => {
      expect(coordinatedSyncFn).toHaveBeenCalledTimes(3); // 2 initial + 1 trailing
    }, { timeout: 2_000 });

    // Give extra time to confirm no fourth call
    await new Promise((r) => setTimeout(r, 300));
    expect(coordinatedSyncFn).toHaveBeenCalledTimes(3);
  });

  // Skip in CI: timing-sensitive test with process locking, unreliable in containers
  it.skipIf(!!process.env.CI)("recovers from stale trailing.lock left by a crashed process", async () => {
    const { writeFile: fsWriteFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    // Pre-create a stale trailing.lock with a dead PID (PID 2 is never a user process)
    const trailingLockPath = join(tempDir, "trailing.lock");
    await fsWriteFile(trailingLockPath, JSON.stringify({ pid: 2, startedAt: new Date().toISOString() }));

    let callCount = 0;
    const coordinatedSyncFn = vi.fn(
      async (): Promise<CoordinatorRunResult> => {
        callCount++;
        if (callCount === 1) {
          return makeResult({
            skippedSync: true,
            skippedReason: "cooldown",
            cooldownRemainingMs: 10,
          });
        }
        return makeResult({ cycles: [{}] });
      },
    );

    await executeNotify({
      source: "claude-code",
      stateDir: tempDir,
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    // Despite stale trailing.lock existing, trailing sync should still fire
    // because the dead PID is detected and the lock is replaced
    await vi.waitFor(() => {
      expect(coordinatedSyncFn).toHaveBeenCalledTimes(2);
    }, { timeout: 5_000 });
  });

  it("does not steal trailing.lock from a live process", async () => {
    const { writeFile: fsWriteFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    // Pre-create trailing.lock with PID 1 (init/launchd — always alive, not us)
    const trailingLockPath = join(tempDir, "trailing.lock");
    await fsWriteFile(trailingLockPath, JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }));

    const coordinatedSyncFn = vi.fn(
      async (): Promise<CoordinatorRunResult> =>
        makeResult({
          skippedSync: true,
          skippedReason: "cooldown",
          cooldownRemainingMs: 10,
        }),
    );

    await executeNotify({
      source: "claude-code",
      stateDir: tempDir,
      executeSyncFn: vi.fn(async () => ({})),
      coordinatedSyncFn,
    });

    // Live PID → trailing.lock is valid → no trailing sync scheduled
    await new Promise((r) => setTimeout(r, 50));
    expect(coordinatedSyncFn).toHaveBeenCalledTimes(1);
  });
});

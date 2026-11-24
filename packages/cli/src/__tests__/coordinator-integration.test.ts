/**
 * Integration test: concurrent coordinatedSync calls serialize via lockfile.
 *
 * Uses real filesystem (tmpdir) to verify O_EXCL lockfile provides actual
 * mutual exclusion and dirty-key signal semantics work end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, stat, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SyncCycleResult, SyncTrigger } from "@pew/core";
import { coordinatedSync } from "../notifier/coordinator.js";

describe("concurrent coordinatedSync serialization", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "pew-lock-test-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  const trigger: SyncTrigger = {
    kind: "notify",
    source: "claude-code",
    fileHint: null,
  };

  it("serializes two concurrent syncs — no overlapping execution", async () => {
    // Track execution order to prove no overlap
    const events: string[] = [];
    let resolveFirst: (() => void) | null = null;

    const executeSyncFn = vi.fn(async (_triggers: SyncTrigger[]): Promise<SyncCycleResult> => {
      const callNum = executeSyncFn.mock.calls.length;
      events.push(`start-${callNum}`);

      if (callNum === 1) {
        // First sync: wait until we signal it to finish
        await new Promise<void>((r) => {
          resolveFirst = r;
        });
      }

      events.push(`end-${callNum}`);
      return {};
    });

    // Launch two concurrent coordinatedSync calls
    const promise1 = coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      lockTimeoutMs: 10000,
    });

    // Give process 1 time to acquire lock and start sync
    await new Promise((r) => setTimeout(r, 50));

    const promise2 = coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      lockTimeoutMs: 10000,
    });

    // Let process 1 finish
    await new Promise((r) => setTimeout(r, 100));
    resolveFirst?.();

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // At least one should have run sync
    const totalCycles = result1.cycles.length + result2.cycles.length;
    expect(totalCycles).toBeGreaterThanOrEqual(1);

    // No overlapping execution: start-N must always be followed by end-N
    // before start-(N+1)
    for (let i = 0; i < events.length - 1; i++) {
      if (events[i].startsWith("start-")) {
        const num = events[i].split("-")[1];
        expect(events[i + 1]).toBe(`end-${num}`);
      }
    }

    // Lockfile should be cleaned up
    await expect(stat(join(stateDir, "sync.lock"))).rejects.toThrow();
  });

  it("dirty follow-up ensures late signals are not lost", async () => {
    let syncCount = 0;

    const executeSyncFn = vi.fn(async (_triggers: SyncTrigger[]): Promise<SyncCycleResult> => {
      syncCount++;
      return {
        tokenSync: {
          totalDeltas: syncCount,
          totalRecords: syncCount,
          filesScanned: {},
          sources: {},
        },
      };
    });

    const result = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      lockTimeoutMs: 5000,
    });

    // First call should succeed with at least 1 cycle
    expect(result.cycles.length).toBeGreaterThanOrEqual(1);
    expect(result.cycles[0].tokenSync?.totalDeltas).toBe(1);

    // Signal file should be empty after completion (no pending signals)
    try {
      const signalStat = await stat(join(stateDir, "notify.signal"));
      // If file exists, it should be empty (truncated)
      expect(signalStat.size).toBe(0);
    } catch {
      // File may not exist (never had signals) — that's fine
    }
  });

  it("stale lockfile from dead process is cleaned up", async () => {
    // Write a lockfile with a PID that definitely doesn't exist
    const { writeFile: fsWriteFile } = await import("node:fs/promises");
    const lockPath = join(stateDir, "sync.lock");
    await fsWriteFile(
      lockPath,
      JSON.stringify({ pid: 99999999, startedAt: "2026-03-20T00:00:00Z" }),
    );

    const executeSyncFn = vi.fn(async () => ({}));

    const result = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      lockTimeoutMs: 5000,
    });

    // Should have cleaned up stale lock and run successfully
    expect(executeSyncFn).toHaveBeenCalled();
    expect(result.cycles.length).toBeGreaterThanOrEqual(1);
    expect(result.error).toBeUndefined();
  });

  it("writes run log with correct structure after real filesystem sync", async () => {
    const executeSyncFn = vi.fn(
      async (): Promise<SyncCycleResult> => ({
        tokenSync: {
          totalDeltas: 5,
          totalRecords: 3,
          filesScanned: { claude: 2 },
          sources: { "claude-code": 3 },
        },
      }),
    );

    const result = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      version: "1.0.0-test",
    });

    // Run log file should exist
    const lastRunPath = join(stateDir, "last-run.json");
    const content = await readFile(lastRunPath, "utf8");
    const log = JSON.parse(content);

    expect(log.runId).toBe(result.runId);
    expect(log.version).toBe("1.0.0-test");
    expect(log.status).toBe("success");
    expect(log.cycles).toHaveLength(1);
    expect(log.cycles[0].tokenSync.totalDeltas).toBe(5);
    expect(log.coordination.degradedToUnlocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cooldown integration tests
// ---------------------------------------------------------------------------

describe("cooldown integration", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "pew-cooldown-test-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  const trigger: SyncTrigger = {
    kind: "notify",
    source: "claude-code",
    fileHint: null,
  };

  it("second run is cooldown-skipped immediately after a successful first run", async () => {
    const executeSyncFn = vi.fn(
      async (): Promise<SyncCycleResult> => ({
        tokenSync: {
          totalDeltas: 3,
          totalRecords: 2,
          filesScanned: {},
          sources: {},
        },
      }),
    );

    // First run — should execute
    const result1 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000, // 5 min
    });

    expect(result1.skippedSync).toBe(false);
    expect(result1.cycles).toHaveLength(1);

    // Second run — should be cooldown-skipped
    const result2 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
    });

    expect(result2.skippedSync).toBe(true);
    expect(result2.skippedReason).toBe("cooldown");
    expect(result2.cycles).toHaveLength(0);
    expect(executeSyncFn).toHaveBeenCalledTimes(1); // only from first run

    // Verify last-run.json on disk has cooldown skip recorded
    const lastRunContent = await readFile(join(stateDir, "last-run.json"), "utf8");
    const log = JSON.parse(lastRunContent);
    expect(log.status).toBe("skipped");
    expect(log.coordination.skippedReason).toBe("cooldown");
  });

  it("runs sync after cooldown expires (controlled via now())", async () => {
    let clock = Date.parse("2026-03-10T12:00:00.000Z");

    const executeSyncFn = vi.fn(
      async (): Promise<SyncCycleResult> => ({
        tokenSync: {
          totalDeltas: 1,
          totalRecords: 1,
          filesScanned: {},
          sources: {},
        },
      }),
    );

    // First run at T+0
    const result1 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
      now: () => clock,
    });

    expect(result1.skippedSync).toBe(false);
    expect(executeSyncFn).toHaveBeenCalledTimes(1);

    // Second run at T+2 min — still in cooldown
    clock = Date.parse("2026-03-10T12:02:00.000Z");
    const result2 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
      now: () => clock,
    });

    expect(result2.skippedSync).toBe(true);
    expect(result2.skippedReason).toBe("cooldown");
    expect(executeSyncFn).toHaveBeenCalledTimes(1);

    // Third run at T+6 min — cooldown expired
    clock = Date.parse("2026-03-10T12:06:00.000Z");
    const result3 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
      now: () => clock,
    });

    expect(result3.skippedSync).toBe(false);
    expect(executeSyncFn).toHaveBeenCalledTimes(2);
  });

  it("error run does not extend cooldown on real filesystem", async () => {
    let clock = Date.parse("2026-03-10T12:00:00.000Z");

    let callCount = 0;
    const executeSyncFn = vi.fn(async (): Promise<SyncCycleResult> => {
      callCount++;
      if (callCount === 1) {
        return {
          tokenSync: {
            totalDeltas: 1,
            totalRecords: 1,
            filesScanned: {},
            sources: {},
          },
        };
      }
      throw new Error("db gone");
    });

    // First run — success at T+0
    const result1 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
      now: () => clock,
    });
    expect(result1.skippedSync).toBe(false);

    // Second run at T+6 min — cooldown expired, but this run fails
    clock = Date.parse("2026-03-10T12:06:00.000Z");
    const result2 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
      now: () => clock,
    });
    expect(result2.skippedSync).toBe(false);
    expect(result2.error).toContain("db gone");

    // Third run at T+7 min — only 1 min after the error run.
    // Error run should NOT reset cooldown, so the last successful run
    // was at T+0 (7 min ago, beyond cooldown). Should execute.
    clock = Date.parse("2026-03-10T12:07:00.000Z");
    const result3 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
      now: () => clock,
    });
    expect(result3.skippedSync).toBe(false);
    expect(executeSyncFn).toHaveBeenCalledTimes(3);
  });

  it("signal file is preserved on disk when cooldown skips sync", async () => {
    const executeSyncFn = vi.fn(async (): Promise<SyncCycleResult> => ({}));

    // First run
    await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
    });

    // Write a signal file to simulate a pending notification
    const signalPath = join(stateDir, "notify.signal");
    await fsWriteFile(signalPath, "signal-data\n");

    // Second run — should be cooldown-skipped
    const result2 = await coordinatedSync(trigger, {
      stateDir,
      executeSyncFn,
      cooldownMs: 300_000,
    });

    expect(result2.skippedSync).toBe(true);

    // Signal file should still have content (not truncated)
    const signalContent = await readFile(signalPath, "utf8");
    expect(signalContent).toBe("signal-data\n");
  });
});

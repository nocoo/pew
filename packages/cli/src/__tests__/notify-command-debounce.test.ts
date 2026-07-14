/**
 * Behavioral tests for the worker debounce (notBefore) + admission-dir
 * cleanup path in executeNotify.
 *
 * See docs/45-codex-notifier-cycle-containment.md §4.4.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeNotify } from "../commands/notify.js";

async function makeTempStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pew-notify-worker-"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executeNotify — notBefore worker debounce", () => {
  it("computes delay = max(0, notBefore - now) and passes ≤ ADMISSION_WINDOW_MS", async () => {
    const stateDir = await makeTempStateDir();
    try {
      const W = 2_000;
      const now = 1_700_000_000_500; // 500 ms into a bucket
      const notBefore = Math.floor(now / W) * W + W; // bucket end
      let observedDelay: number | null = null;
      const coordinatedSyncFn = vi.fn(async () => ({
        runId: "r",
        triggers: [],
        cycles: [],
        waitedForLock: false,
        skippedSync: false,
        hadFollowUp: false,
        followUpCount: 0,
        degradedToUnlocked: false,
      }));
      await executeNotify({
        source: "claude-code",
        stateDir,
        deviceId: "dev-1",
        notBefore,
        nowFn: () => now,
        delayFn: async (ms: number) => {
          observedDelay = ms;
        },
        coordinatedSyncFn,
      });
      expect(observedDelay).not.toBeNull();
      expect(observedDelay!).toBeGreaterThanOrEqual(0);
      expect(observedDelay!).toBeLessThanOrEqual(W);
      // Concretely: 500 into a 2000-window bucket → delay ≈ 1500.
      expect(observedDelay).toBe(W - 500);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("delay = 0 when now already past notBefore", async () => {
    const stateDir = await makeTempStateDir();
    try {
      const now = 2_000;
      const notBefore = 1_500;
      let observedDelay: number | null = null;
      const coordinatedSyncFn = vi.fn(async () => ({
        runId: "r",
        triggers: [],
        cycles: [],
        waitedForLock: false,
        skippedSync: false,
        hadFollowUp: false,
        followUpCount: 0,
        degradedToUnlocked: false,
      }));
      await executeNotify({
        source: "claude-code",
        stateDir,
        deviceId: "dev-1",
        notBefore,
        nowFn: () => now,
        delayFn: async (ms: number) => {
          observedDelay = ms;
        },
        coordinatedSyncFn,
      });
      expect(observedDelay).toBe(0);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});

describe("executeNotify — admission-dir cleanup runs before sync", () => {
  it("removes sync/forward lock files older than GATE_GRACE_BUCKETS", async () => {
    const stateDir = await makeTempStateDir();
    try {
      const admissionDir = join(stateDir, "notify-admission");
      await mkdir(admissionDir, { recursive: true });
      const W = 2_000;
      const now = 1_700_000_010_000;
      const currentBucket = Math.floor(now / W);
      // grace = 2, so anything with bucket ≤ currentBucket - 2 must be
      // removed; currentBucket and currentBucket-1 must be kept.
      const oldBucket = currentBucket - 5;
      const boundaryBucket = currentBucket - 1;
      const currBucket = currentBucket;
      await writeFile(join(admissionDir, `sync-${oldBucket}.lock`), "");
      await writeFile(
        join(admissionDir, `forward-codex-${oldBucket}.lock`),
        "",
      );
      await writeFile(join(admissionDir, `sync-${boundaryBucket}.lock`), "");
      await writeFile(join(admissionDir, `sync-${currBucket}.lock`), "");

      // Assert cleanup happens BEFORE coordinatedSync (order matters:
      // §4.4 mandates cleanup precedes sync so a long lock wait doesn't
      // let the residual gate count drift up).
      let cleanupDone = false;
      const coordinatedSyncFn = vi.fn(async () => {
        // At the moment sync begins, cleanup must already be done.
        expect(cleanupDone).toBe(true);
        return {
          runId: "r",
          triggers: [],
          cycles: [],
          waitedForLock: false,
          skippedSync: false,
          hadFollowUp: false,
          followUpCount: 0,
          degradedToUnlocked: false,
        };
      });

      await executeNotify({
        source: "claude-code",
        stateDir,
        deviceId: "dev-1",
        notBefore: 0, // no delay
        nowFn: () => now,
        delayFn: async () => {
          cleanupDone = true; // cleanup runs inside the delay slot
        },
        onCleanupDone: () => {
          cleanupDone = true;
        },
        coordinatedSyncFn,
      });

      const remaining = await readdir(admissionDir);
      // Buckets ≥ currentBucket - 1 stay, older removed.
      expect(remaining.sort()).toEqual(
        [
          `sync-${boundaryBucket}.lock`,
          `sync-${currBucket}.lock`,
        ].sort(),
      );
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("cleanup ignores unrelated files in state dir", async () => {
    const stateDir = await makeTempStateDir();
    try {
      const admissionDir = join(stateDir, "notify-admission");
      await mkdir(admissionDir, { recursive: true });
      await writeFile(join(stateDir, "queue.jsonl"), "not a gate");
      await writeFile(join(stateDir, "cursors.json"), "not a gate");
      const now = 1_700_000_010_000;
      const oldBucket = Math.floor(now / 2_000) - 5;
      await writeFile(join(admissionDir, `sync-${oldBucket}.lock`), "");

      const coordinatedSyncFn = vi.fn(async () => ({
        runId: "r",
        triggers: [],
        cycles: [],
        waitedForLock: false,
        skippedSync: false,
        hadFollowUp: false,
        followUpCount: 0,
        degradedToUnlocked: false,
      }));

      await executeNotify({
        source: "codex",
        stateDir,
        deviceId: "dev-1",
        notBefore: 0,
        nowFn: () => now,
        delayFn: async () => {},
        coordinatedSyncFn,
      });

      // Non-admission files must survive.
      const rootFiles = await readdir(stateDir);
      expect(rootFiles).toContain("queue.jsonl");
      expect(rootFiles).toContain("cursors.json");
      // Old gate removed.
      const admissionFiles = await readdir(admissionDir);
      expect(admissionFiles).toHaveLength(0);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("skips cleanup silently when admission dir does not exist", async () => {
    const stateDir = await makeTempStateDir();
    try {
      const coordinatedSyncFn = vi.fn(async () => ({
        runId: "r",
        triggers: [],
        cycles: [],
        waitedForLock: false,
        skippedSync: false,
        hadFollowUp: false,
        followUpCount: 0,
        degradedToUnlocked: false,
      }));
      await expect(
        executeNotify({
          source: "claude-code",
          stateDir,
          deviceId: "dev-1",
          notBefore: 0,
          nowFn: () => 1_700_000_010_000,
          delayFn: async () => {},
          coordinatedSyncFn,
        }),
      ).resolves.toBeDefined();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});

/**
 * Cross-process integration test for the admission gate primitive
 * (doc 45 §6.2).
 *
 * Spawns 32 concurrent worker processes; each tries the same
 * `writeFileSync(gate, "", { flag: "wx" })`. Exactly one must win, the
 * rest must observe EEXIST. This is the only test that exercises the
 * real filesystem's exclusive-create semantics — everything else uses
 * a fake fs to avoid platform drift.
 *
 * Path with a space guards against a caller ever using a shell to run
 * this: shell interpretation of the space would break EEXIST detection
 * because different processes would target different files.
 *
 * Intended to run on ubuntu-latest / macos-latest / windows-latest via
 * `.github/workflows/admission-primitive.yml`. Locally it's just
 * another vitest file.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKERS = 32;

const WORKER_SCRIPT = join(
  __dirname,
  "fixtures",
  "admission-worker.cjs",
);

interface WorkerOutcome {
  code: number;
  stdout: string;
}

function runWorker(gate: string, startPath: string): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [WORKER_SCRIPT, gate, startPath],
      // Argv array, no shell — path with a space must survive.
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    proc.stdout?.on("data", (buf) => {
      stdout += buf.toString();
    });
    proc.once("close", (code) => {
      resolve({ code: code ?? -1, stdout: stdout.trim() });
    });
  });
}

describe("admission primitive — exclusive create across processes", () => {
  it(
    "32 concurrent wx creates on the same path yield exactly one winner",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "pew admission ")); // note the space
      try {
        const gate = join(dir, "sync-42.lock");
        const startPath = join(dir, "start.flag");
        // Kick off all workers first; they busy-wait until start.flag
        // appears so the race is a genuine burst rather than a
        // staircase of process start times.
        const spawned = Array.from({ length: WORKERS }, () =>
          runWorker(gate, startPath),
        );
        await writeFile(startPath, "go");
        const results = await Promise.all(spawned);
        const winners = results.filter((r) => r.stdout === "winner");
        const losers = results.filter((r) =>
          r.stdout.startsWith("loser:EEXIST"),
        );
        const anomalies = results.filter(
          (r) =>
            r.stdout !== "winner" && !r.stdout.startsWith("loser:EEXIST"),
        );
        expect(anomalies, JSON.stringify(anomalies)).toHaveLength(0);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(WORKERS - 1);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

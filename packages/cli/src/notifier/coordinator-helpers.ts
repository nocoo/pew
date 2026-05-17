/**
 * Pure helpers extracted from coordinator.ts to keep that file under the
 * 400-LOC complexity guideline. No runtime behavior change — these functions
 * are byte-identical to their original inline definitions.
 */
import { join } from "node:path";
import type { CoordinatorRunResult, RunLogEntry } from "@pew/core";

export interface SignalFsOps {
  stat: (path: string) => Promise<{ size: number }>;
  appendFile: (path: string, data: string) => Promise<unknown>;
  writeFile: (path: string, data: string) => Promise<unknown>;
  readFile: (path: string) => Promise<string>;
}

/**
 * Derive a coordinator run log status from a CoordinatorRunResult.
 *
 * Precedence (first match wins):
 *  1. skippedSync             → "skipped"
 *  2. error + no cycles       → "error"
 *  3. no cycles               → "skipped"
 *  4. mixed success + error   → "partial"
 *  5. any error               → "error"
 *  6. otherwise               → "success"
 */
export function deriveStatus(
  result: CoordinatorRunResult,
): RunLogEntry["status"] {
  if (result.skippedSync) return "skipped";

  // Coordinator-level error with no cycles means the run itself failed
  if (result.error != null && result.cycles.length === 0) return "error";
  if (result.cycles.length === 0) return "skipped";

  const hasError =
    result.cycles.some(
      (c) => c.tokenSyncError != null || c.sessionSyncError != null,
    ) || result.error != null;

  const hasSuccess = result.cycles.some(
    (c) => c.tokenSync != null || c.sessionSync != null,
  );

  if (hasError && hasSuccess) return "partial";
  if (hasError) return "error";
  return "success";
}

/** Stringify an unknown thrown value. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read `<stateDir>/last-success.json` (a single ISO timestamp string).
 * Returns null on missing/empty/unreadable file.
 */
export async function readLastSuccessAt(
  stateDir: string,
  fs: Pick<SignalFsOps, "readFile">,
): Promise<string | null> {
  try {
    const content = await fs.readFile(join(stateDir, "last-success.json"));
    const trimmed = String(content).trim();
    if (trimmed.length === 0) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Stat `<stateDir>/notify.signal`, treating ENOENT as size 0. */
export async function readSignalSize(
  stateDir: string,
  fs: Pick<SignalFsOps, "stat">,
): Promise<number> {
  try {
    const file = await fs.stat(join(stateDir, "notify.signal"));
    return file.size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return 0;
    }
    throw err;
  }
}

/** Append a newline to `<stateDir>/notify.signal`. */
export async function appendSignal(
  stateDir: string,
  fs: Pick<SignalFsOps, "appendFile">,
): Promise<void> {
  await fs.appendFile(join(stateDir, "notify.signal"), "\n");
}

/** Truncate `<stateDir>/notify.signal` to empty. */
export async function truncateSignal(
  stateDir: string,
  fs: Pick<SignalFsOps, "writeFile">,
): Promise<void> {
  await fs.writeFile(join(stateDir, "notify.signal"), "");
}

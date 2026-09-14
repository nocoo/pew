import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { recoverSyncCommit } from "../storage/sync-commit.js";
import { withStateLock } from "../storage/state-lock.js";

/**
 * Files to delete during reset — pew's own state only.
 * Raw AI tool data (~/.claude/, ~/.gemini/ etc.) is NEVER touched.
 */
const STATE_FILES = [
  "cursors.json",
  "queue.jsonl",
  "queue.state.json",
  "session-cursors.json",
  "session-queue.jsonl",
  "session-queue.state.json",
] as const;

export interface ResetOptions {
  stateDir: string;
  /** Override for testing — defaults to fs.unlink */
  unlinkFn?: typeof unlink;
}

interface ResetFileResult {
  file: string;
  deleted: boolean;
}

export interface ResetResult {
  files: ResetFileResult[];
}

/**
 * Delete all pew sync/upload state files so the next `pew sync`
 * performs a clean full scan.
 */
export async function executeReset(opts: ResetOptions): Promise<ResetResult> {
  return withStateLock(opts.stateDir, () => resetLocked(opts));
}

async function resetLocked(opts: ResetOptions): Promise<ResetResult> {
  await recoverSyncCommit(opts.stateDir);
  const unlinkFn = opts.unlinkFn ?? unlink;
  const files: ResetFileResult[] = [];

  for (const name of STATE_FILES) {
    const path = join(opts.stateDir, name);
    try {
      await unlinkFn(path);
      files.push({ file: name, deleted: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        files.push({ file: name, deleted: false });
      } else {
        throw err;
      }
    }
  }

  return { files };
}

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountingRecord, CursorState, EvidenceRecord, QueueRecord } from "@pew/core";
import { AccountingQueue } from "./accounting-queue.js";
import { EvidenceQueue } from "./evidence-queue.js";
import { LocalQueue } from "./local-queue.js";
import { CursorStore } from "./cursor-store.js";
import { SECURE_DIR_MODE } from "./secure-mkdir.js";

interface SyncCommit {
  version: 1;
  records?: QueueRecord[];
  dirtyKeys?: string[];
  evidence: EvidenceRecord[];
  accounting: AccountingRecord[];
  replay: boolean;
  cursors: CursorState;
}

/** Recover absolute writes BEFORE reading a source cursor or uploading any queue. */
export async function recoverSyncCommit(stateDir: string): Promise<void> {
  const path = join(stateDir, "sync-commit.json");
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  let commit: SyncCommit;
  try {
    commit = JSON.parse(raw);
    if (commit.version !== 1 || !commit.cursors || !Array.isArray(commit.accounting) || !Array.isArray(commit.evidence)) throw new Error();
  } catch { throw new Error("Invalid pending sync commit; preserve Pew state for recovery"); }
  await new EvidenceQueue(stateDir).merge(commit.evidence, commit.replay);
  await new AccountingQueue(stateDir).merge(commit.accounting, commit.replay);
  if (commit.records) {
    const queue = new LocalQueue(stateDir);
    await queue.saveDirtyKeys(commit.dirtyKeys ?? []);
    await queue.overwrite(commit.records);
    await queue.saveOffset(0);
  }
  await new CursorStore(stateDir).save(commit.cursors);
  await unlink(path);
}

/** The single journal makes queue/detail/cursor replacement retryable after any partial write. */
export async function commitSync(stateDir: string, commit: SyncCommit): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: SECURE_DIR_MODE });
  const path = join(stateDir, "sync-commit.json");
  await writeFile(`${path}.tmp`, JSON.stringify(commit), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  await recoverSyncCommit(stateDir);
}

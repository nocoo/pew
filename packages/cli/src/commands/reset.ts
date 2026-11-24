import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { QueueRecord, SessionQueueRecord } from "@pew/core";
import { LocalQueue } from "../storage/local-queue.js";
import { SessionQueue } from "../storage/session-queue.js";
import { isRetiredSource, readRetainedQueueState } from "../utils/retired-sources.js";
import { tokenRecordKey, readAntigravityBaseline } from "../utils/antigravity-snapshot.js";
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
  const tokens = await readAntigravityBaseline(opts.stateDir, true);
  let sessions: SessionQueueRecord[] = [];
  let sessionOffset = 0;
  try {
    const raw = await readFile(join(opts.stateDir, "session-queue.jsonl"), "utf8");
    const rows = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionQueueRecord);
    if (rows.some((r) => !r || typeof r !== "object" || typeof r.source !== "string"))
      throw new Error();
    sessions = rows.filter((r) => isRetiredSource(r.source));
    if (
      sessions.some(
        (r) =>
          typeof r.session_key !== "string" ||
          !r.session_key ||
          ![r.started_at, r.last_message_at, r.snapshot_at].every(
            (t) => typeof t === "string" && Number.isFinite(Date.parse(t)),
          ) ||
          ![r.duration_seconds, r.user_messages, r.assistant_messages, r.total_messages].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          ),
      )
    )
      throw new Error();
    if (sessions.length) {
      const state = await readRetainedQueueState(opts.stateDir, "session-queue.state.json");
      let offset = 0;
      for (const line of raw.split("\n")) {
        offset += Buffer.byteLength(line) + 1;
        if (
          line &&
          offset <= state.offset &&
          isRetiredSource((JSON.parse(line) as SessionQueueRecord).source)
        ) {
          sessionOffset += Buffer.byteLength(`${JSON.stringify(JSON.parse(line))}\n`);
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Cannot verify previous session queue");
  }
  const keep = new Set<string>();
  const preserved: Array<() => Promise<void>> = [];
  for (const [queue, records, recordKey, names] of [
    [new LocalQueue(opts.stateDir), tokens, tokenRecordKey, ["queue.jsonl", "queue.state.json"]],
    [
      new SessionQueue(opts.stateDir),
      sessions,
      (r: SessionQueueRecord) => r.session_key,
      ["session-queue.jsonl", "session-queue.state.json"],
    ],
  ] as const) {
    if (!records.length) continue;
    const state = await readRetainedQueueState(opts.stateDir, names[1]);
    const pending =
      state.dirtyKeys ??
      (await queue.readFromOffset(state.offset)).records.map((r) =>
        "session_key" in r ? r.session_key : tokenRecordKey(r),
      );
    const keys = new Set(records.map((r) => recordKey(r as QueueRecord & SessionQueueRecord)));
    preserved.push(async () => {
      await queue.saveState(
        names[0] === "session-queue.jsonl"
          ? { offset: 0 }
          : { offset: 0, dirtyKeys: pending.filter((key) => keys.has(key)) },
      );
      await queue.overwrite(records as QueueRecord[] & SessionQueueRecord[]);
      if (names[0] === "session-queue.jsonl") await queue.saveState({ offset: sessionOffset });
    });
    for (const name of names) keep.add(name);
  }
  const cursorNames = ["cursors.json", "session-cursors.json"];
  for (const name of [...cursorNames, ...STATE_FILES.filter((n) => !cursorNames.includes(n))]) {
    if (keep.has(name)) {
      files.push({ file: name, deleted: false });
      continue;
    }
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
  for (const persist of preserved) await persist();

  return {
    files: files.sort(
      (a, b) =>
        STATE_FILES.indexOf(a.file as (typeof STATE_FILES)[number]) -
        STATE_FILES.indexOf(b.file as (typeof STATE_FILES)[number]),
    ),
  };
}

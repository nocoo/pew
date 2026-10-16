/**
 * WorkBuddy session collector.
 *
 * Full-scans a WorkBuddy session JSONL file and extracts session-level
 * metadata. One file normally holds one session (`sessionId` field equal to
 * the file stem), but records are grouped by their own `sessionId` so a file
 * carrying more than one still produces one snapshot per session.
 *
 * Counts follow the harness-source convention: `userMessages` /
 * `assistantMessages` count `type: "message"` rows by role, and
 * `totalMessages` counts every message-bearing row (tool calls, reasoning and
 * results included). Auxiliary metadata rows — `ai-title`,
 * `file-history-snapshot` and `session-meta` — are excluded by type: on live
 * installs the title and session-meta rows carry a `sessionId`, so a
 * session-id filter alone would count them.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isValidISODate, MAX_RECORD_MESSAGES, MAX_SESSION_DURATION_SECONDS, MAX_STRING_LENGTH, type SessionSnapshot, type Source } from "@pew/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";
import { isRepresentableEpochMs } from "../utils/time.js";

export interface WorkbuddySessionAccum {
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  minMs: number | null;
  maxMs: number | null;
  cwd: string | null;
  lastModel: string | null;
}

/**
 * Build uploadable snapshots from per-session accumulators. Exported for
 * tests: the server caps message counts at 1e8, far past what a test can
 * write to disk, so the count gate is exercised on accumulators directly.
 */
export function buildWorkbuddySessionSnapshots(
  sessions: Iterable<WorkbuddySessionAccum>,
): SessionSnapshot[] {
  const snapshotAt = new Date().toISOString();
  const results: SessionSnapshot[] = [];

  for (const accum of sessions) {
    if (accum.minMs === null) continue; // no usable timestamps → skip

    // The server rejects a session_key over MAX_STRING_LENGTH with a 400 and
    // the upload engine does not retry or skip a 4xx — one over-long id would
    // wedge every later upload. Drop that session instead of queueing it.
    const sessionKey = `workbuddy:${accum.sessionId}`;
    if (sessionKey.length > MAX_STRING_LENGTH) continue;

    // Same wedge logic for the duration: the server caps duration_seconds at
    // MAX_SESSION_DURATION_SECONDS (~10 years) and rejects the batch with a
    // 400. Two individually-valid bounds on a clock-skewed machine can span
    // millennia, so drop the snapshot rather than queue it.
    const durationSeconds = Math.max(
      0,
      Math.floor(((accum.maxMs ?? accum.minMs) - accum.minMs) / 1000),
    );
    if (durationSeconds > MAX_SESSION_DURATION_SECONDS) continue;

    // Same wedge logic for the message counts: the server caps each count at
    // MAX_RECORD_MESSAGES and rejects the batch with a 400, and the upload
    // engine does not retry a 4xx — a corrupted file with an absurd count
    // would wedge every later session upload. Drop the snapshot.
    if (accum.totalMessages > MAX_RECORD_MESSAGES ||
      accum.userMessages > MAX_RECORD_MESSAGES ||
      accum.assistantMessages > MAX_RECORD_MESSAGES) continue;

    const startedAt = new Date(accum.minMs).toISOString();
    const lastMessageAt = new Date(accum.maxMs ?? accum.minMs).toISOString();

    results.push({
      sessionKey,
      source: "workbuddy" as Source,
      kind: "human",
      startedAt,
      lastMessageAt,
      durationSeconds,
      userMessages: accum.userMessages,
      assistantMessages: accum.assistantMessages,
      totalMessages: accum.totalMessages,
      projectRef: accum.cwd ? hashProjectRef(accum.cwd) : null,
      model: accum.lastModel,
      snapshotAt,
    });
  }

  return results;
}

/**
 * Collect session snapshots from a WorkBuddy session JSONL file.
 */
export async function collectWorkbuddySessions(
  filePath: string,
): Promise<SessionSnapshot[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile() || st.size === 0) return [];

  const sessions = new Map<string, WorkbuddySessionAccum>();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : null;
      if (!sessionId) continue;

      // Auxiliary metadata rows: excluded by type, not by session id.
      // `session-meta` and `ai-title` both carry a sessionId on live installs;
      // excluding them keeps totalMessages message-only and leaves the time
      // bounds derived from real messages alone.
      if (
        obj.type === "ai-title" ||
        obj.type === "file-history-snapshot" ||
        obj.type === "session-meta"
      ) {
        continue;
      }

      let accum = sessions.get(sessionId);
      if (!accum) {
        accum = {
          sessionId,
          userMessages: 0,
          assistantMessages: 0,
          totalMessages: 0,
          minMs: null,
          maxMs: null,
          cwd: null,
          lastModel: null,
        };
        sessions.set(sessionId, accum);
      }

      accum.totalMessages++;
      if (obj.type === "message") {
        if (obj.role === "user") accum.userMessages++;
        else if (obj.role === "assistant") accum.assistantMessages++;
      }

      // WorkBuddy writes integer epoch milliseconds; ISO strings are tolerated
      // so a future format change degrades to "fewer bounds" rather than a
      // crash. Both paths must satisfy the server's ISO date rule, whose
      // regex only accepts a 4-digit year — the number path because
      // isRepresentableEpochMs is wider than that window, and the string
      // path because Date.parse also accepts extended years like
      // "+275760-…", whose toISOString renders a 6-digit year and would
      // 400 the whole upload batch. Gate once on the resulting ms.
      const rawMs =
        typeof obj.timestamp === "number"
          ? isRepresentableEpochMs(obj.timestamp)
            ? obj.timestamp
            : Number.NaN
          : typeof obj.timestamp === "string"
            ? Date.parse(obj.timestamp)
            : Number.NaN;
      const ms =
        Number.isFinite(rawMs) && isValidISODate(new Date(rawMs).toISOString())
          ? rawMs
          : Number.NaN;
      if (Number.isFinite(ms)) {
        if (accum.minMs === null || ms < accum.minMs) accum.minMs = ms;
        if (accum.maxMs === null || ms > accum.maxMs) accum.maxMs = ms;
      }

      if (!accum.cwd && typeof obj.cwd === "string" && obj.cwd.length > 0) {
        accum.cwd = obj.cwd;
      }

      const providerData =
        obj.providerData !== null && typeof obj.providerData === "object"
          ? (obj.providerData as Record<string, unknown>)
          : null;
      const model =
        typeof providerData?.model === "string" ? providerData.model.trim() : "";
      if (model && model.length <= MAX_STRING_LENGTH) accum.lastModel = model;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return buildWorkbuddySessionSnapshots(sessions.values());
}

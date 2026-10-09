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
import type { SessionSnapshot, Source } from "@pew/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";

interface SessionAccum {
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
 * Collect session snapshots from a WorkBuddy session JSONL file.
 */
export async function collectWorkbuddySessions(
  filePath: string,
): Promise<SessionSnapshot[]> {
  const st = await stat(filePath).catch(() => null);
  if (!st?.isFile() || st.size === 0) return [];

  const sessions = new Map<string, SessionAccum>();

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
      // so a future format change degrades to "fewer bounds" rather than a crash.
      const ms =
        typeof obj.timestamp === "number" && Number.isFinite(obj.timestamp)
          ? obj.timestamp
          : typeof obj.timestamp === "string"
            ? Date.parse(obj.timestamp)
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
      if (model) accum.lastModel = model;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const snapshotAt = new Date().toISOString();
  const results: SessionSnapshot[] = [];

  for (const accum of sessions.values()) {
    if (accum.minMs === null) continue; // no usable timestamps → skip

    const startedAt = new Date(accum.minMs).toISOString();
    const lastMessageAt = new Date(accum.maxMs ?? accum.minMs).toISOString();

    results.push({
      sessionKey: `workbuddy:${accum.sessionId}`,
      source: "workbuddy" as Source,
      kind: "human",
      startedAt,
      lastMessageAt,
      durationSeconds: Math.max(
        0,
        Math.floor(((accum.maxMs ?? accum.minMs) - accum.minMs) / 1000),
      ),
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

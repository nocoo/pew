/**
 * OpenCode SQLite session collector.
 *
 * Queries the `session` and `message` tables from opencode.db
 * to produce SessionSnapshot records. Uses dependency injection
 * (pre-fetched rows) for testability without bun:sqlite.
 */

import type { SessionSnapshot, Source } from "@pew/core";
import { hashProjectRef } from "../utils/hash-project-ref.js";
import { coerceEpochMs } from "../utils/time.js";

/** Row shape from the session table */
export interface SessionRow {
  id: string;
  project_id: string | null;
  title: string | null;
  time_created: number;
  time_updated: number;
}

/** Row shape from message table for session collection (minimal) */
export interface SessionMessageRow {
  session_id: string;
  role: string;
  time_created: number;
  data: string;
}

/**
 * Collect session snapshots from pre-fetched SQLite rows.
 *
 * Groups messages by session, counts roles, tracks timestamps and model.
 * Uses session table time_created/time_updated as fallback timestamps
 * when message-level time is unavailable.
 */
export function collectOpenCodeSqliteSessions(
  sessions: SessionRow[],
  messages: SessionMessageRow[],
): SessionSnapshot[] {
  if (sessions.length === 0) return [];

  // Group messages by session_id
  const msgMap = new Map<string, SessionMessageRow[]>();
  for (const msg of messages) {
    const list = msgMap.get(msg.session_id);
    if (list) {
      list.push(msg);
    } else {
      msgMap.set(msg.session_id, [msg]);
    }
  }

  const snapshots: SessionSnapshot[] = [];

  for (const session of sessions) {
    const sessionMessages = msgMap.get(session.id) ?? [];

    let userMessages = 0;
    let assistantMessages = 0;
    const totalMessages = sessionMessages.length;

    let minEpochMs: number | null = null;
    let maxEpochMs: number | null = null;
    let lastModel: string | null = null;

    for (const msg of sessionMessages) {
      // Count by role from the role column (faster than parsing JSON)
      if (msg.role === "user") {
        userMessages++;
      } else if (msg.role === "assistant") {
        assistantMessages++;
      }

      // Parse data JSON for time and model extraction
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(msg.data);
      } catch {
        // If data is corrupted, we still count the message but skip time/model
      }

      if (data) {
        const time = data.time as Record<string, unknown> | undefined;
        if (time) {
          const completedMs = coerceEpochMs(time.completed);
          const createdMs = coerceEpochMs(time.created);

          const msgStart = createdMs || completedMs;
          const msgEnd = completedMs || createdMs;

          if (msgStart) {
            if (!minEpochMs || msgStart < minEpochMs) minEpochMs = msgStart;
          }
          if (msgEnd) {
            if (!maxEpochMs || msgEnd > maxEpochMs) maxEpochMs = msgEnd;
          }
        }

        // Track model from assistant messages
        const model =
          typeof data.modelID === "string"
            ? data.modelID.trim()
            : typeof data.model === "string"
              ? (data.model as string).trim()
              : null;
        if (model) {
          lastModel = model;
        }
      }
    }

    // Fallback to session table timestamps if messages lack time
    if (!minEpochMs) {
      minEpochMs = coerceEpochMs(session.time_created) || null;
    }
    if (!maxEpochMs) {
      maxEpochMs = coerceEpochMs(session.time_updated) || minEpochMs;
    }

    // Must have at least a start time
    if (!minEpochMs) continue;

    const endMs = maxEpochMs ?? minEpochMs;

    snapshots.push({
      sessionKey: `opencode:${session.id}`,
      source: "opencode" as Source,
      kind: "human",
      startedAt: new Date(minEpochMs).toISOString(),
      lastMessageAt: new Date(endMs).toISOString(),
      durationSeconds: Math.max(0, Math.floor((endMs - minEpochMs) / 1000)),
      userMessages,
      assistantMessages,
      totalMessages,
      projectRef: hashProjectRef(session.project_id ?? null),
      model: lastModel,
      snapshotAt: new Date().toISOString(),
    });
  }

  return snapshots;
}

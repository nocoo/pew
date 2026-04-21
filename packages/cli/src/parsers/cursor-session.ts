/**
 * Cursor session parser.
 *
 * Extracts SessionSnapshot[] from Cursor's state.vscdb database.
 * Reads composer conversations from the cursorDiskKV table (modern format)
 * and ItemTable (older format).
 */

import type { SessionSnapshot } from "@pew/core";
import type { CursorKVRow } from "./cursor-db.js";

// ---------------------------------------------------------------------------
// Internal types for Cursor's JSON data
// ---------------------------------------------------------------------------

interface CursorMessage {
  type: number; // 1 = user, 2 = assistant
  text?: string;
  timestamp?: number;
  modelType?: string;
}

interface ComposerData {
  composerId: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  conversation?: CursorMessage[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse composer data rows into SessionSnapshots.
 *
 * Accepts rows from both cursorDiskKV (one composer per row) and
 * ItemTable (all composers in a single row).
 */
export function collectCursorSessions(
  kvRows: CursorKVRow[],
  itemRows: CursorKVRow[],
): SessionSnapshot[] {
  const now = new Date().toISOString();
  const composers = new Map<string, ComposerData>();

  // Modern format: one composer per key
  for (const row of kvRows) {
    try {
      const data = JSON.parse(row.value) as ComposerData;
      if (data.composerId) {
        composers.set(data.composerId, data);
      }
    } catch {
      // Skip unparseable rows
    }
  }

  // Older format: all composers in a single JSON object
  for (const row of itemRows) {
    try {
      const parsed = JSON.parse(row.value);
      // Could be an array or an object with composer entries
      const entries: ComposerData[] = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null
          ? Object.values(parsed)
          : [];
      for (const data of entries) {
        if (data.composerId && !composers.has(data.composerId)) {
          composers.set(data.composerId, data);
        }
      }
    } catch {
      // Skip unparseable rows
    }
  }

  const snapshots: SessionSnapshot[] = [];

  for (const composer of composers.values()) {
    const conversation = composer.conversation ?? [];
    if (conversation.length === 0) continue;

    const userMessages = conversation.filter((m) => m.type === 1).length;
    const assistantMessages = conversation.filter((m) => m.type === 2).length;

    // Timestamps
    const timestamps = conversation
      .map((m) => m.timestamp)
      .filter((t): t is number => typeof t === "number" && t > 0);

    const firstTs = timestamps.length > 0
      ? Math.min(...timestamps)
      : composer.createdAt ?? 0;
    const lastTs = timestamps.length > 0
      ? Math.max(...timestamps)
      : composer.lastUpdatedAt ?? firstTs;

    if (firstTs === 0) continue; // No valid timestamps

    const startedAt = new Date(firstTs).toISOString();
    const lastMessageAt = new Date(lastTs).toISOString();
    const durationSeconds = Math.max(0, Math.round((lastTs - firstTs) / 1000));

    // Model: most frequent modelType from assistant messages
    const modelCounts = new Map<string, number>();
    for (const m of conversation) {
      if (m.type === 2 && m.modelType) {
        modelCounts.set(m.modelType, (modelCounts.get(m.modelType) ?? 0) + 1);
      }
    }
    let model: string | null = null;
    let maxCount = 0;
    for (const [m, c] of modelCounts) {
      if (c > maxCount) {
        model = m;
        maxCount = c;
      }
    }

    snapshots.push({
      sessionKey: `cursor:composer:${composer.composerId}`,
      source: "cursor",
      kind: "human",
      startedAt,
      lastMessageAt,
      durationSeconds,
      userMessages,
      assistantMessages,
      totalMessages: conversation.length,
      projectRef: null,
      model,
      snapshotAt: now,
    });
  }

  return snapshots;
}

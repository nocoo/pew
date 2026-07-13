/**
 * ZCode SQLite session parser.
 *
 * Consumes ZcodeSessionDb (adapter handle) and produces SessionSnapshot[]
 * for pew's session pipeline. Doc: docs/43-zcode-support.md §4.
 */

import type { SessionSnapshot } from "@pew/core";
import type { ZcodeSessionDb, ZcodeSessionRow } from "./zcode-types.js";

/** Result of one parseZcodeSessions() run. */
export interface ZcodeSessionParseResult {
  snapshots: SessionSnapshot[];
  /** Highest time_updated seen in the batch (epoch ms). Zero when empty. */
  maxTimeUpdated: number;
  /** IDs at exactly maxTimeUpdated — next-run lastProcessedIds. */
  boundaryIds: string[];
  /** Raw session rows queried; used for driver.rowCount. */
  rowCount: number;
  /** Non-fatal advisories (currently unused). */
  warnings: string[];
}

export interface ParseZcodeSessionsOpts {
  db: ZcodeSessionDb;
  lastTimeUpdated: number | null;
  lastProcessedIds?: readonly string[];
  /** Injectable clock for deterministic snapshotAt in tests. */
  now?: () => Date;
}

/**
 * Convert a ZcodeSessionRow (plus per-session queries via the handle)
 * into a SessionSnapshot conforming to @pew/core types.
 */
function toSnapshot(
  row: ZcodeSessionRow,
  db: ZcodeSessionDb,
  now: Date,
): SessionSnapshot {
  const counts = db.queryMessages(row.id);
  const primaryModel = db.queryPrimaryModel(row.id);
  const startedAt = new Date(row.timeCreated).toISOString();
  const lastMessageAt = new Date(row.timeUpdated).toISOString();
  const durationSeconds = Math.max(
    0,
    Math.floor((row.timeUpdated - row.timeCreated) / 1000),
  );
  const trimmedDirectory = row.directory?.trim() ?? "";
  const projectRef = trimmedDirectory.length > 0 ? trimmedDirectory : null;
  return {
    sessionKey: `zcode:${row.id}`,
    source: "zcode",
    kind: "human",
    startedAt,
    lastMessageAt,
    durationSeconds,
    userMessages: counts.user,
    assistantMessages: counts.assistant,
    totalMessages: counts.total,
    projectRef,
    model: primaryModel,
    snapshotAt: now.toISOString(),
  };
}

export function parseZcodeSessions(
  opts: ParseZcodeSessionsOpts,
): ZcodeSessionParseResult {
  const { db, lastTimeUpdated } = opts;
  const skipIds = opts.lastProcessedIds ?? [];
  const now = (opts.now ?? (() => new Date()))();

  const rows = db.querySessions(lastTimeUpdated, skipIds);

  const snapshots: SessionSnapshot[] = [];
  let maxTimeUpdated = 0;
  const boundaryIds: string[] = [];

  for (const row of rows) {
    if (row.timeUpdated > maxTimeUpdated) {
      maxTimeUpdated = row.timeUpdated;
      boundaryIds.length = 0;
      boundaryIds.push(row.id);
    } else if (row.timeUpdated === maxTimeUpdated) {
      boundaryIds.push(row.id);
    }
    snapshots.push(toSnapshot(row, db, now));
  }

  return {
    snapshots,
    maxTimeUpdated,
    boundaryIds,
    rowCount: rows.length,
    warnings: [],
  };
}

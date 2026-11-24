/**
 * OpenCode SQLite DB session driver.
 *
 * Strategy: Watermark-based query (WHERE time_updated >= ?).
 * Manages its own DB handle lifecycle.
 * Deduplicates via lastProcessedIds for same-millisecond boundary rows.
 */

import { stat } from "node:fs/promises";
import type { OpenCodeSqliteSessionCursor } from "@pew/core";
import { collectOpenCodeSqliteSessions } from "../../parsers/opencode-sqlite-session.js";
import type { SessionRow, SessionMessageRow } from "../../parsers/opencode-sqlite-session.js";
import type { DbSessionDriver, DbSessionResult, SyncContext } from "../types.js";

/** Options needed to construct the SQLite session driver */
export interface OpenCodeSqliteSessionDriverOpts {
  /** Path to the OpenCode SQLite database */
  dbPath: string;
  /** Factory for opening the DB (DI for testability) */
  openSessionDb: (dbPath: string) => {
    querySessions: (lastTimeUpdated: number) => SessionRow[];
    querySessionMessages: (sessionIds: string[]) => SessionMessageRow[];
    close: () => void;
  } | null;
}

export function createOpenCodeSqliteSessionDriver(
  opts: OpenCodeSqliteSessionDriverOpts,
): DbSessionDriver<OpenCodeSqliteSessionCursor> {
  return {
    kind: "db",
    source: "opencode",

    async run(
      prevCursor: OpenCodeSqliteSessionCursor | undefined,
      _ctx: SyncContext,
    ): Promise<DbSessionResult<OpenCodeSqliteSessionCursor>> {
      // Check if DB file exists
      const dbStat = await stat(opts.dbPath).catch(() => null);
      if (!dbStat) {
        return {
          snapshots: [],
          cursor: prevCursor ?? {
            lastTimeUpdated: 0,
            lastProcessedIds: [],
            inode: 0,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      const dbInode = dbStat.ino;

      // If inode changed (DB recreated), reset cursor
      const lastTimeUpdated =
        prevCursor && prevCursor.inode === dbInode ? prevCursor.lastTimeUpdated : 0;
      const prevProcessedIds = new Set(
        prevCursor && prevCursor.inode === dbInode ? (prevCursor.lastProcessedIds ?? []) : [],
      );

      const handle = opts.openSessionDb(opts.dbPath);
      if (!handle) {
        return {
          snapshots: [],
          cursor: prevCursor ?? {
            lastTimeUpdated: 0,
            lastProcessedIds: [],
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      try {
        // Query uses >= to avoid missing same-millisecond rows.
        // We dedup previously-processed IDs from the prior batch.
        const rawSessions = handle.querySessions(lastTimeUpdated);
        const sessions =
          prevProcessedIds.size > 0
            ? rawSessions.filter((s) => !prevProcessedIds.has(s.id))
            : rawSessions;

        let snapshots: import("@pew/core").SessionSnapshot[] = [];

        if (sessions.length > 0) {
          const sessionIds = sessions.map((s) => s.id);
          const messages = handle.querySessionMessages(sessionIds);
          snapshots = collectOpenCodeSqliteSessions(sessions, messages);
        }

        // Update cursor — advance past ALL queried sessions.
        // Sessions are ORDER BY time_updated ASC, so last has the max.
        const maxTimeUpdated =
          rawSessions.length > 0
            ? rawSessions[rawSessions.length - 1].time_updated
            : lastTimeUpdated;
        const idsAtMax = rawSessions
          .filter((s) => s.time_updated === maxTimeUpdated)
          .map((s) => s.id);

        return {
          snapshots,
          cursor: {
            lastTimeUpdated: maxTimeUpdated,
            lastProcessedIds: idsAtMax,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: rawSessions.length,
        };
      } finally {
        handle.close();
      }
    },
  };
}

/**
 * Cursor SQLite DB session driver.
 *
 * Reads composer conversations from Cursor's state.vscdb file.
 * Uses lastUpdatedAt watermark for incremental sync.
 */

import { stat } from "node:fs/promises";
import type { CursorSqliteCursor } from "@pew/core";
import { collectCursorSessions } from "../../parsers/cursor-session.js";
import type { CursorKVRow } from "../../parsers/cursor-db.js";
import type { DbSessionDriver, DbSessionResult, SyncContext } from "../types.js";

/** Options needed to construct the Cursor SQLite session driver */
export interface CursorSqliteSessionDriverOpts {
  /** Path to the Cursor state.vscdb database */
  dbPath: string;
  /** Factory for opening the DB (DI for testability) */
  openCursorDb: (dbPath: string) => {
    queryComposers: () => CursorKVRow[];
    queryItemTable: () => CursorKVRow[];
    close: () => void;
  } | null;
}

export function createCursorSqliteSessionDriver(
  opts: CursorSqliteSessionDriverOpts,
): DbSessionDriver<CursorSqliteCursor> {
  return {
    kind: "db",
    source: "cursor",

    async run(
      prevCursor: CursorSqliteCursor | undefined,
      _ctx: SyncContext,
    ): Promise<DbSessionResult<CursorSqliteCursor>> {
      // Check if DB file exists
      const dbStat = await stat(opts.dbPath).catch(() => null);
      if (!dbStat) {
        return {
          snapshots: [],
          cursor: prevCursor ?? {
            lastUpdatedAt: 0,
            inode: 0,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      const dbInode = dbStat.ino;

      // If inode changed (DB recreated), reset cursor
      const lastUpdatedAt =
        prevCursor && prevCursor.inode === dbInode
          ? prevCursor.lastUpdatedAt
          : 0;

      const handle = opts.openCursorDb(opts.dbPath);
      if (!handle) {
        return {
          snapshots: [],
          cursor: prevCursor ?? {
            lastUpdatedAt: 0,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      try {
        const kvRows = handle.queryComposers();
        const itemRows = handle.queryItemTable();
        const totalRows = kvRows.length + itemRows.length;

        // Parse all composers into snapshots
        const allSnapshots = collectCursorSessions(kvRows, itemRows);

        // Filter to only sessions updated since last cursor
        const snapshots = lastUpdatedAt > 0
          ? allSnapshots.filter((s) => {
              const lastMsg = new Date(s.lastMessageAt).getTime();
              return lastMsg > lastUpdatedAt;
            })
          : allSnapshots;

        // Update watermark to the max lastMessageAt
        let maxUpdatedAt = lastUpdatedAt;
        for (const s of allSnapshots) {
          const ts = new Date(s.lastMessageAt).getTime();
          if (ts > maxUpdatedAt) maxUpdatedAt = ts;
        }

        return {
          snapshots,
          cursor: {
            lastUpdatedAt: maxUpdatedAt,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: totalRows,
        };
      } finally {
        handle.close();
      }
    },
  };
}

/**
 * ZCode SQLite DB token driver.
 *
 * Strategy: watermark on `model_usage.completed_at` + boundary-ms
 * lastProcessedIds dedup. Inode change → cursor reset (full rescan).
 * Requires an injected openZcodeDb factory (native SQLite is optional).
 *
 * Doc: docs/43-zcode-support.md §二挑战 4 + §3.
 */

import { stat } from "node:fs/promises";
import type { ZcodeSqliteCursor } from "@pew/core";
import { parseZcodeSqlite } from "../../parsers/zcode-sqlite.js";
import type { ZcodeUsageDb } from "../../parsers/zcode-types.js";
import type { DbTokenDriver, DbTokenResult, SyncContext } from "../types.js";

export interface ZcodeSqliteTokenDriverOpts {
  /** Path to the ZCode SQLite database */
  dbPath: string;
  /** Factory for opening the DB (DI for testability) */
  openZcodeDb: (dbPath: string) => ZcodeUsageDb | null;
}

function emptyCursor(inode: number): ZcodeSqliteCursor {
  return {
    lastCompletedAt: 0,
    lastProcessedIds: [],
    inode,
    updatedAt: new Date().toISOString(),
  };
}

export function createZcodeSqliteTokenDriver(
  opts: ZcodeSqliteTokenDriverOpts,
): DbTokenDriver<ZcodeSqliteCursor> {
  return {
    kind: "db",
    source: "zcode",

    async run(
      prevCursor: ZcodeSqliteCursor | undefined,
      _ctx: SyncContext,
    ): Promise<DbTokenResult<ZcodeSqliteCursor>> {
      const dbStat = await stat(opts.dbPath).catch(() => null);
      if (!dbStat) {
        return {
          deltas: [],
          cursor: prevCursor ?? emptyCursor(0),
          rowCount: 0,
        };
      }

      const dbInode = dbStat.ino;

      // inode change (or fresh cursor) → force full rescan.
      const cursorValid =
        prevCursor !== undefined && prevCursor.inode === dbInode;
      const lastCompletedAt = cursorValid ? prevCursor.lastCompletedAt : 0;
      const priorIds = cursorValid ? prevCursor.lastProcessedIds ?? [] : [];

      const handle = opts.openZcodeDb(opts.dbPath);
      if (!handle) {
        return {
          deltas: [],
          cursor: prevCursor ?? emptyCursor(dbInode),
          rowCount: 0,
        };
      }

      try {
        const result = parseZcodeSqlite({
          db: handle,
          lastCompletedAt: lastCompletedAt === 0 ? null : lastCompletedAt,
          lastProcessedIds: priorIds,
        });

        // Cursor advancement:
        //   - if the batch had rows, use its (maxCompletedAt, boundaryIds)
        //   - otherwise keep the previous watermark
        const nextCompletedAt =
          result.maxCompletedAt > 0
            ? result.maxCompletedAt
            : lastCompletedAt;
        const nextIds =
          result.maxCompletedAt > 0 ? result.boundaryIds : priorIds;

        return {
          deltas: result.deltas,
          cursor: {
            lastCompletedAt: nextCompletedAt,
            lastProcessedIds: nextIds,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: result.rowCount,
          warnings: result.warnings.length > 0 ? result.warnings : undefined,
        };
      } finally {
        handle.close();
      }
    },
  };
}

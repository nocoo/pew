/**
 * ZCode SQLite DB session driver.
 *
 * Strategy: watermark on `session.time_updated` + boundary-ms
 * lastProcessedIds dedup. Inode change → cursor reset.
 * Requires an injected openZcodeSessionDb factory.
 *
 * Doc: docs/43-zcode-support.md §4.
 */

import { stat } from "node:fs/promises";
import type { ZcodeSqliteSessionCursor } from "@pew/core";
import { parseZcodeSessions } from "../../parsers/zcode-session.js";
import type { ZcodeSessionDb } from "../../parsers/zcode-types.js";
import type { DbSessionDriver, DbSessionResult, SyncContext } from "../types.js";

export interface ZcodeSqliteSessionDriverOpts {
  /** Path to the ZCode SQLite database */
  dbPath: string;
  /** Factory for opening the DB (DI for testability) */
  openZcodeSessionDb: (dbPath: string) => ZcodeSessionDb | null;
}

function emptyCursor(inode: number): ZcodeSqliteSessionCursor {
  return {
    lastTimeUpdated: 0,
    lastProcessedIds: [],
    inode,
    updatedAt: new Date().toISOString(),
  };
}

export function createZcodeSqliteSessionDriver(
  opts: ZcodeSqliteSessionDriverOpts,
): DbSessionDriver<ZcodeSqliteSessionCursor> {
  return {
    kind: "db",
    source: "zcode",

    async run(
      prevCursor: ZcodeSqliteSessionCursor | undefined,
      _ctx: SyncContext,
    ): Promise<DbSessionResult<ZcodeSqliteSessionCursor>> {
      const dbStat = await stat(opts.dbPath).catch(() => null);
      if (!dbStat) {
        return {
          snapshots: [],
          cursor: prevCursor ?? emptyCursor(0),
          rowCount: 0,
        };
      }

      const dbInode = dbStat.ino;
      const cursorValid =
        prevCursor !== undefined && prevCursor.inode === dbInode;
      const lastTimeUpdated = cursorValid ? prevCursor.lastTimeUpdated : 0;
      const priorIds = cursorValid ? prevCursor.lastProcessedIds ?? [] : [];

      const handle = opts.openZcodeSessionDb(opts.dbPath);
      if (!handle) {
        return {
          snapshots: [],
          cursor: prevCursor ?? emptyCursor(dbInode),
          rowCount: 0,
        };
      }

      try {
        const result = parseZcodeSessions({
          db: handle,
          lastTimeUpdated: lastTimeUpdated === 0 ? null : lastTimeUpdated,
          lastProcessedIds: priorIds,
        });

        // Cursor advancement (mirrors token driver — see doc §二挑战 4):
        //   - watermark advanced  → adopt fresh (maxTimeUpdated, boundaryIds)
        //   - watermark unchanged → merge priorIds ∪ boundaryIds so
        //     next-cycle skipIds keeps repelling all same-ms rows
        //   - no rows returned    → keep both watermark and priorIds
        let nextTimeUpdated: number;
        let nextIds: string[];
        if (result.maxTimeUpdated > lastTimeUpdated) {
          nextTimeUpdated = result.maxTimeUpdated;
          nextIds = result.boundaryIds;
        } else if (
          result.maxTimeUpdated === lastTimeUpdated &&
          result.maxTimeUpdated > 0
        ) {
          nextTimeUpdated = lastTimeUpdated;
          const merged = new Set(priorIds);
          for (const id of result.boundaryIds) merged.add(id);
          nextIds = [...merged];
        } else {
          nextTimeUpdated = lastTimeUpdated;
          nextIds = priorIds.slice();
        }

        return {
          snapshots: result.snapshots,
          cursor: {
            lastTimeUpdated: nextTimeUpdated,
            lastProcessedIds: nextIds,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: result.rowCount,
          warnings:
            result.warnings.length > 0 ? result.warnings : undefined,
        };
      } finally {
        handle.close();
      }
    },
  };
}

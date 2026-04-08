/**
 * Hermes Agent SQLite DB token driver.
 *
 * Strategy: Session-level diff model.
 * Manages its own DB handle lifecycle.
 * Computes delta = current totals - last known totals per session.
 *
 * This driver requires a factory function (openHermesDb) to be provided
 * via constructor options, since the native SQLite module is not always available.
 */

import { stat } from "node:fs/promises";
import type { HermesSqliteCursor } from "@pew/core";
import { parseHermesDatabase } from "../../parsers/hermes-sqlite.js";
import type { QuerySessionsFn } from "../../parsers/hermes-sqlite.js";
import type { DbTokenDriver, DbTokenResult, SyncContext } from "../types.js";

/** Options needed to construct the Hermes SQLite token driver */
export interface HermesSqliteTokenDriverOpts {
  /** Path to the Hermes SQLite database */
  dbPath: string;
  /** Factory for opening the DB (DI for testability — native SQLite not always available) */
  openHermesDb: (dbPath: string) => { querySessions: QuerySessionsFn; close: () => void } | null;
}

export function createHermesSqliteTokenDriver(
  opts: HermesSqliteTokenDriverOpts,
): DbTokenDriver<HermesSqliteCursor> {
  return {
    kind: "db",
    source: "hermes",

    async run(
      prevCursor: HermesSqliteCursor | undefined,
      _ctx: SyncContext,
    ): Promise<DbTokenResult<HermesSqliteCursor>> {
      // Check if DB file exists
      const dbStat = await stat(opts.dbPath).catch(() => null);
      if (!dbStat) {
        return {
          deltas: [],
          cursor: prevCursor ?? {
            sessionTotals: {},
            inode: 0,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      const handle = opts.openHermesDb(opts.dbPath);
      if (!handle) {
        return {
          deltas: [],
          cursor: prevCursor ?? {
            sessionTotals: {},
            inode: dbStat.ino,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      try {
        const result = await parseHermesDatabase(
          opts.dbPath,
          handle.querySessions,
          prevCursor,
        );

        return {
          deltas: result.deltas,
          cursor: result.cursor,
          rowCount: result.deltas.length,
        };
      } finally {
        handle.close();
      }
    },
  };
}

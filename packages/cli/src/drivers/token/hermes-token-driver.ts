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
import type { HermesQueryHandle } from "../../parsers/hermes-sqlite.js";
import { readHermesReviewCalls } from "../../parsers/hermes-review.js";
import { collectHermesUsageEvidence } from "../../parsers/hermes-usage-evidence.js";
import type { DbTokenDriver, DbTokenResult, SyncContext } from "../types.js";

/** Options needed to construct the Hermes SQLite token driver */
export interface HermesSqliteTokenDriverOpts {
  /** Path to the Hermes SQLite database */
  dbPath: string;
  /**
   * Key identifying this DB instance for cursor storage.
   * E.g. "default" for ~/.hermes/state.db, "profiles/tomato" for profile DBs.
   */
  dbKey: string;
  /** Factory for opening the DB (DI for testability — native SQLite not always available) */
  openHermesDb: (dbPath: string) => HermesQueryHandle | null;
  /** Explicit log timezone for isolated fixtures; real Hermes uses local wall time. */
  logUtcOffsetMinutes?: number;
}

export function createHermesSqliteTokenDriver(
  opts: HermesSqliteTokenDriverOpts,
): DbTokenDriver<HermesSqliteCursor> & { dbKey: string } {
  return {
    kind: "db",
    source: "hermes",
    dbKey: opts.dbKey,

    async run(
      prevCursor: HermesSqliteCursor | undefined,
      ctx: SyncContext,
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

        const warnings: string[] = [];
        if (handle.queryAuxiliaryUsage) {
          try {
            const rows = handle.queryAuxiliaryUsage();
            const calls = await readHermesReviewCalls(opts.dbPath, opts.dbKey, opts.logUtcOffsetMinutes).catch(() => {
              warnings.push("Hermes review timestamps unavailable; retaining cumulative ledger usage");
              return [];
            });
            result.deltas.push(...collectHermesUsageEvidence({ dbKey: opts.dbKey, rows, calls, previous: ctx.evidenceRecords ?? [] }));
          } catch {
            warnings.push("Hermes auxiliary evidence unavailable; main session accounting preserved");
          }
        }
        return {
          deltas: result.deltas,
          cursor: result.cursor,
          rowCount: result.rowCount,
          ...(warnings.length ? { warnings } : {}),
        };
      } finally {
        handle.close();
      }
    },
  };
}

/**
 * OpenCode SQLite DB token driver.
 *
 * Strategy: Watermark-based query (WHERE time_created >= ?).
 * Manages its own DB handle lifecycle.
 * Reads ctx.messageKeys for cross-source dedup with OpenCode JSON.
 *
 * This driver requires a factory function (openMessageDb) to be provided
 * via constructor options, since the native SQLite module is not always available.
 */

import { stat } from "node:fs/promises";
import type { OpenCodeSqliteCursor } from "@pew/core";
import { processOpenCodeMessages } from "../../parsers/opencode-sqlite.js";
import type { QueryMessagesFn } from "../../parsers/opencode-sqlite.js";
import type { DbTokenDriver, DbTokenResult, SyncContext } from "../types.js";

/** Options needed to construct the SQLite token driver */
export interface OpenCodeSqliteTokenDriverOpts {
  /** Path to the OpenCode SQLite database */
  dbPath: string;
  /** Factory for opening the DB (DI for testability — native SQLite not always available) */
  openMessageDb: (dbPath: string) => { queryMessages: QueryMessagesFn; close: () => void } | null;
}

export function createOpenCodeSqliteTokenDriver(
  opts: OpenCodeSqliteTokenDriverOpts,
): DbTokenDriver<OpenCodeSqliteCursor> {
  return {
    kind: "db",
    source: "opencode",

    async run(
      prevCursor: OpenCodeSqliteCursor | undefined,
      ctx: SyncContext,
    ): Promise<DbTokenResult<OpenCodeSqliteCursor>> {
      // Check if DB file exists
      const dbStat = await stat(opts.dbPath).catch(() => null);
      if (!dbStat) {
        return {
          deltas: [],
          cursor: prevCursor ?? {
            lastTimeCreated: 0,
            lastProcessedIds: [],
            lastSessionUpdated: 0,
            inode: 0,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      const dbInode = dbStat.ino;

      // If inode changed (DB recreated), reset cursor
      const lastTimeCreated =
        prevCursor && prevCursor.inode === dbInode
          ? prevCursor.lastTimeCreated
          : 0;
      const prevProcessedIds = new Set(
        prevCursor && prevCursor.inode === dbInode
          ? (prevCursor.lastProcessedIds ?? [])
          : [],
      );

      const handle = opts.openMessageDb(opts.dbPath);
      if (!handle) {
        return {
          deltas: [],
          cursor: prevCursor ?? {
            lastTimeCreated: 0,
            lastProcessedIds: [],
            lastSessionUpdated: 0,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: 0,
        };
      }

      try {
        // Query uses >= to avoid missing same-millisecond rows.
        // We dedup previously-processed IDs from the prior batch.
        const rawRows = handle.queryMessages(lastTimeCreated);
        const rows = prevProcessedIds.size > 0
          ? rawRows.filter((r) => !prevProcessedIds.has(r.id))
          : rawRows;

        // Read messageKeys from context for cross-source dedup.
        // During the overlap window, both JSON and SQLite sources contain
        // the same messages. We skip any SQLite row whose messageKey is
        // already tracked by a JSON file cursor.
        const jsonMessageKeys = ctx.messageKeys ?? new Set<string>();

        const filteredRows = rows.filter((row) => {
          if (row.role !== "assistant") return true;
          const key = `${row.session_id}|${row.id}`;
          return !jsonMessageKeys.has(key);
        });

        const result = processOpenCodeMessages(filteredRows, ...(ctx.collectAccounting ? [true] as const : []));

        // Update cursor — advance past ALL rows (including deduped).
        const maxTime = rawRows.length > 0
          ? rawRows[rawRows.length - 1].time_created
          : lastTimeCreated;
        const idsAtMax = rawRows
          .filter((r) => r.time_created === maxTime)
          .map((r) => r.id);

        return {
          deltas: result.deltas,
          cursor: {
            lastTimeCreated: maxTime,
            lastProcessedIds: idsAtMax,
            lastSessionUpdated: prevCursor?.lastSessionUpdated ?? 0,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          },
          rowCount: rawRows.length,
        };
      } finally {
        handle.close();
      }
    },
  };
}

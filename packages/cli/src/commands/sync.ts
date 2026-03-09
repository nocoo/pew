import { stat } from "node:fs/promises";
import type {
  ByteOffsetCursor,
  CursorState,
  GeminiCursor,
  OpenCodeCursor,
  OpenCodeSqliteCursor,
  QueueRecord,
  Source,
  TokenDelta,
} from "@pew/core";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import {
  discoverClaudeFiles,
  discoverGeminiFiles,
  discoverOpenCodeFiles,
  discoverOpenClawFiles,
} from "../discovery/sources.js";
import type { OpenCodeDiscoveryResult } from "../discovery/sources.js";
import { parseClaudeFile } from "../parsers/claude.js";
import { parseGeminiFile } from "../parsers/gemini.js";
import { parseOpenCodeFile } from "../parsers/opencode.js";
import { parseOpenClawFile } from "../parsers/openclaw.js";
import { processOpenCodeMessages } from "../parsers/opencode-sqlite.js";
import type { QueryMessagesFn } from "../parsers/opencode-sqlite.js";
import type { ParsedDelta } from "../parsers/claude.js";
import { toUtcHalfHourStart, bucketKey, addTokens, emptyTokenDelta } from "../utils/buckets.js";

/** Sync execution options */
export interface SyncOptions {
  /** Directory for persisting state (cursors, queue) */
  stateDir: string;
  /** Override: Claude data directory (~/.claude) */
  claudeDir?: string;
  /** Override: Gemini data directory (~/.gemini) */
  geminiDir?: string;
  /** Override: OpenCode message directory (~/.local/share/opencode/storage/message) */
  openCodeMessageDir?: string;
  /** Override: OpenCode SQLite database path (~/.local/share/opencode/opencode.db) */
  openCodeDbPath?: string;
  /** Factory for opening the OpenCode SQLite DB (DI for testability) */
  openMessageDb?: (dbPath: string) => { queryMessages: QueryMessagesFn; close: () => void } | null;
  /** Override: OpenClaw data directory (~/.openclaw) */
  openclawDir?: string;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
}

/** Progress event for UI display */
export interface ProgressEvent {
  source: string;
  phase: "discover" | "parse" | "aggregate" | "done" | "warn";
  current?: number;
  total?: number;
  message?: string;
}

/** Result of a sync execution */
export interface SyncResult {
  totalDeltas: number;
  totalRecords: number;
  sources: {
    claude: number;
    gemini: number;
    opencode: number;
    openclaw: number;
  };
  /** Total files scanned per source */
  filesScanned: {
    claude: number;
    gemini: number;
    opencode: number;
    openclaw: number;
  };
}

/** Internal bucket for aggregating deltas */
interface Bucket {
  source: Source;
  model: string;
  hourStart: string;
  tokens: TokenDelta;
}

/**
 * Execute the sync operation: discover files, parse incrementally,
 * aggregate into half-hour buckets, and write to local queue.
 *
 * Pure logic — no CLI I/O. Receives all dependencies via options.
 */
export async function executeSync(opts: SyncOptions): Promise<SyncResult> {
  const { stateDir, onProgress } = opts;

  const cursorStore = new CursorStore(stateDir);
  const queue = new LocalQueue(stateDir);
  const cursors = await cursorStore.load();

  const allDeltas: ParsedDelta[] = [];
  const sourceCounts = { claude: 0, gemini: 0, opencode: 0, openclaw: 0 };
  const filesScanned = { claude: 0, gemini: 0, opencode: 0, openclaw: 0 };

  // ---------- Claude Code ----------
  if (opts.claudeDir) {
    onProgress?.({
      source: "claude-code",
      phase: "discover",
      message: "Discovering Claude Code files...",
    });
    const files = await discoverClaudeFiles(opts.claudeDir);
    filesScanned.claude = files.length;
    onProgress?.({      source: "claude-code",
      phase: "parse",
      total: files.length,
      message: `Parsing ${files.length} Claude files...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const prev = cursors.files[filePath] as ByteOffsetCursor | undefined;
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const inode = st.ino;
      const startOffset =
        prev && prev.inode === inode ? (prev.offset ?? 0) : 0;

      const result = await parseClaudeFile({ filePath, startOffset }).catch(
        (err: unknown) => {
          onProgress?.({
            source: "claude-code",
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return null;
        },
      );
      if (!result) continue;

      cursors.files[filePath] = {
        inode,
        offset: result.endOffset,
        updatedAt: new Date().toISOString(),
      } satisfies ByteOffsetCursor;

      allDeltas.push(...result.deltas);
      sourceCounts.claude += result.deltas.length;

      onProgress?.({
        source: "claude-code",
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }
  }

  // ---------- Gemini CLI ----------
  if (opts.geminiDir) {
    onProgress?.({
      source: "gemini-cli",
      phase: "discover",
      message: "Discovering Gemini CLI files...",
    });
    const files = await discoverGeminiFiles(opts.geminiDir);
    filesScanned.gemini = files.length;
    onProgress?.({
      source: "gemini-cli",
      phase: "parse",
      total: files.length,
      message: `Parsing ${files.length} Gemini files...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const prev = cursors.files[filePath] as GeminiCursor | undefined;
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const inode = st.ino;
      const startIndex =
        prev && prev.inode === inode ? (prev.lastIndex ?? -1) : -1;
      const lastTotals =
        prev && prev.inode === inode ? (prev.lastTotals ?? null) : null;

      const result = await parseGeminiFile({
        filePath,
        startIndex,
        lastTotals,
      }).catch((err: unknown) => {
        onProgress?.({
          source: "gemini-cli",
          phase: "warn",
          message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        });
        return null;
      });
      if (!result) continue;

      cursors.files[filePath] = {
        inode,
        lastIndex: result.lastIndex,
        lastTotals: result.lastTotals,
        lastModel: result.lastModel,
        updatedAt: new Date().toISOString(),
      } satisfies GeminiCursor;

      allDeltas.push(...result.deltas);
      sourceCounts.gemini += result.deltas.length;

      onProgress?.({
        source: "gemini-cli",
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }
  }

  // ---------- OpenCode ----------
  if (opts.openCodeMessageDir) {
    onProgress?.({
      source: "opencode",
      phase: "discover",
      message: "Discovering OpenCode files...",
    });
    const discovery = await discoverOpenCodeFiles(
      opts.openCodeMessageDir,
      cursors.dirMtimes,
    );
    const files = discovery.files;
    // Count includes files in skipped dirs (already tracked in cursors)
    filesScanned.opencode = files.length;
    onProgress?.({
      source: "opencode",
      phase: "parse",
      total: files.length,
      message: `Parsing ${files.length} OpenCode files (${discovery.skippedDirs} dirs skipped)...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const prev = cursors.files[filePath] as OpenCodeCursor | undefined;
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const inode = st.ino;

      // Triple-check unchanged optimization
      if (
        prev &&
        prev.inode === inode &&
        prev.size === st.size &&
        prev.mtimeMs === st.mtimeMs
      ) {
        onProgress?.({
          source: "opencode",
          phase: "parse",
          current: i + 1,
          total: files.length,
        });
        continue;
      }

      const lastTotals =
        prev && prev.inode === inode ? (prev.lastTotals ?? null) : null;

      const result = await parseOpenCodeFile({ filePath, lastTotals }).catch(
        (err: unknown) => {
          onProgress?.({
            source: "opencode",
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return null;
        },
      );
      if (!result) continue;

      cursors.files[filePath] = {
        inode,
        size: st.size,
        mtimeMs: st.mtimeMs,
        lastTotals: result.lastTotals,
        messageKey: result.messageKey,
        updatedAt: new Date().toISOString(),
      } satisfies OpenCodeCursor;

      if (result.delta) {
        allDeltas.push(result.delta);
        sourceCounts.opencode += 1;
      }

      onProgress?.({
        source: "opencode",
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }

    // Persist directory mtimes for next run
    cursors.dirMtimes = discovery.dirMtimes;
  }

  // ---------- OpenCode SQLite ----------
  if (opts.openCodeDbPath) {
    onProgress?.({
      source: "opencode-sqlite",
      phase: "discover",
      message: "Checking OpenCode SQLite database...",
    });

    // Check if DB file exists
    const dbStat = await stat(opts.openCodeDbPath).catch(() => null);

    if (dbStat && !opts.openMessageDb) {
      // DB file exists but adapter is missing (bun:sqlite not available)
      onProgress?.({
        source: "opencode-sqlite",
        phase: "warn",
        message: `OpenCode SQLite database found at ${opts.openCodeDbPath} but bun:sqlite is not available — SQLite token data will NOT be synced`,
      });
    } else if (dbStat && opts.openMessageDb) {
      const dbInode = dbStat.ino;
      const prevSqlite = cursors.openCodeSqlite;

      // If inode changed (DB recreated), reset cursor
      const lastTimeCreated =
        prevSqlite && prevSqlite.inode === dbInode
          ? prevSqlite.lastTimeCreated
          : 0;
      const prevProcessedIds = new Set(
        prevSqlite && prevSqlite.inode === dbInode
          ? (prevSqlite.lastProcessedIds ?? [])
          : [],
      );

      const handle = opts.openMessageDb(opts.openCodeDbPath);
      if (handle) {
        try {
          // Query uses >= to avoid missing same-millisecond rows.
          // We dedup previously-processed IDs from the prior batch.
          const rawRows = handle.queryMessages(lastTimeCreated);
          const rows = prevProcessedIds.size > 0
            ? rawRows.filter((r) => !prevProcessedIds.has(r.id))
            : rawRows;

          // Collect JSON messageKeys from cursor store for dedup.
          // During the overlap window (~Feb 15-17), both JSON and SQLite
          // sources contain the same messages. We skip any SQLite row
          // whose messageKey is already tracked by a JSON file cursor.
          const jsonMessageKeys = new Set<string>();
          for (const cursor of Object.values(cursors.files)) {
            const oc = cursor as OpenCodeCursor;
            if (oc.messageKey) {
              jsonMessageKeys.add(oc.messageKey);
            }
          }

          // Filter rows: exclude assistant messages already tracked by JSON parser.
          // row.role is extracted at the SQL level via json_extract — no need to
          // parse the full data JSON here.
          const filteredRows = rows.filter((row) => {
            if (row.role !== "assistant") return true; // non-assistant rows don't produce deltas
            const key = `${row.session_id}|${row.id}`;
            return !jsonMessageKeys.has(key);
          });

          const dedupSkipped = rows.length - filteredRows.length;
          const result = processOpenCodeMessages(filteredRows);

          onProgress?.({
            source: "opencode-sqlite",
            phase: "parse",
            message: `Parsed ${result.deltas.length} deltas from ${rawRows.length} SQLite rows${dedupSkipped > 0 ? ` (${dedupSkipped} deduped)` : ""}`,
          });

          allDeltas.push(...result.deltas);
          sourceCounts.opencode += result.deltas.length;

          // Update SQLite cursor — advance past ALL rows (including deduped).
          // Rows are ORDER BY time_created ASC, so the last row has the
          // highest time_created. Track IDs at the max timestamp for
          // same-millisecond dedup on the next query.
          const maxTime = rawRows.length > 0
            ? rawRows[rawRows.length - 1].time_created
            : lastTimeCreated;
          const idsAtMax = rawRows
            .filter((r) => r.time_created === maxTime)
            .map((r) => r.id);
          cursors.openCodeSqlite = {
            lastTimeCreated: maxTime,
            lastProcessedIds: idsAtMax,
            lastSessionUpdated: prevSqlite?.lastSessionUpdated ?? 0,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          } satisfies OpenCodeSqliteCursor;
        } finally {
          handle.close();
        }
      } else {
        // openMessageDb returned null — DB exists but couldn't be opened
        onProgress?.({
          source: "opencode-sqlite",
          phase: "warn",
          message: `Failed to open OpenCode SQLite database at ${opts.openCodeDbPath} — SQLite token data will NOT be synced`,
        });
      }
    }
  }

  // ---------- OpenClaw ----------
  if (opts.openclawDir) {
    onProgress?.({
      source: "openclaw",
      phase: "discover",
      message: "Discovering OpenClaw files...",
    });
    const files = await discoverOpenClawFiles(opts.openclawDir);
    filesScanned.openclaw = files.length;
    onProgress?.({
      source: "openclaw",
      phase: "parse",
      total: files.length,
      message: `Parsing ${files.length} OpenClaw files...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const prev = cursors.files[filePath] as ByteOffsetCursor | undefined;
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const inode = st.ino;
      const startOffset =
        prev && prev.inode === inode ? (prev.offset ?? 0) : 0;

      const result = await parseOpenClawFile({ filePath, startOffset }).catch(
        (err: unknown) => {
          onProgress?.({
            source: "openclaw",
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return null;
        },
      );
      if (!result) continue;

      cursors.files[filePath] = {
        inode,
        offset: result.endOffset,
        updatedAt: new Date().toISOString(),
      } satisfies ByteOffsetCursor;

      allDeltas.push(...result.deltas);
      sourceCounts.openclaw += result.deltas.length;

      onProgress?.({
        source: "openclaw",
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }
  }

  // ---------- Aggregate into half-hour buckets ----------
  onProgress?.({
    source: "all",
    phase: "aggregate",
    message: `Aggregating ${allDeltas.length} deltas into buckets...`,
  });

  const buckets = new Map<string, Bucket>();

  for (const delta of allDeltas) {
    const hourStart = toUtcHalfHourStart(delta.timestamp);
    if (!hourStart) continue;

    const key = bucketKey(delta.source, delta.model, hourStart);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        source: delta.source,
        model: delta.model,
        hourStart,
        tokens: emptyTokenDelta(),
      };
      buckets.set(key, bucket);
    }
    addTokens(bucket.tokens, delta.tokens);
  }

  // ---------- Write to queue ----------
  const records: QueueRecord[] = [];
  for (const bucket of buckets.values()) {
    const totalTokens =
      bucket.tokens.inputTokens +
      bucket.tokens.cachedInputTokens +
      bucket.tokens.outputTokens +
      bucket.tokens.reasoningOutputTokens;

    records.push({
      source: bucket.source,
      model: bucket.model,
      hour_start: bucket.hourStart,
      input_tokens: bucket.tokens.inputTokens,
      cached_input_tokens: bucket.tokens.cachedInputTokens,
      output_tokens: bucket.tokens.outputTokens,
      reasoning_output_tokens: bucket.tokens.reasoningOutputTokens,
      total_tokens: totalTokens,
    });
  }

  // ---------- Save cursor state FIRST (before queue) ----------
  // Cursor must be persisted before the queue write so that a crash
  // between the two operations does not cause double-counting on the
  // next sync. Worst case: cursor saved but queue not written — data
  // is lost for this cycle (acceptable), but never duplicated.
  cursors.updatedAt = new Date().toISOString();
  await cursorStore.save(cursors);

  // ---------- Write to queue ----------
  if (records.length > 0) {
    await queue.appendBatch(records);
  }

  onProgress?.({
    source: "all",
    phase: "done",
    message: `Synced ${allDeltas.length} events → ${records.length} records`,
  });

  return {
    totalDeltas: allDeltas.length,
    totalRecords: records.length,
    sources: sourceCounts,
    filesScanned,
  };
}

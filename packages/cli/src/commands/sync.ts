import { stat } from "node:fs/promises";
import type {
  CursorState,
  FileCursor,
  FileCursorBase,
  OpenCodeSqliteCursor,
  QueueRecord,
  Source,
  TokenDelta,
} from "@pew/core";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import type { OnCorruptLine } from "../storage/base-queue.js";
import type { QueryMessagesFn } from "../parsers/opencode-sqlite.js";
import type { ParsedDelta } from "../parsers/claude.js";
import { toUtcHalfHourStart, bucketKey, addTokens, emptyTokenDelta } from "../utils/buckets.js";
import { createTokenDrivers } from "../drivers/registry.js";
import type { SyncContext, FileFingerprint } from "../drivers/types.js";
import { aggregateRecords } from "./upload.js";

/** Sync execution options */
export interface SyncOptions {
  /** Directory for persisting state (cursors, queue) */
  stateDir: string;
  /** Stable device identifier (from ConfigManager.ensureDeviceId()) */
  deviceId: string;
  /** Override: Claude data directory (~/.claude) */
  claudeDir?: string;
  /** Override: Codex CLI sessions directory (~/.codex/sessions) */
  codexSessionsDir?: string;
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
  /** Override: VSCode Copilot base directories (stable + insiders) */
  vscodeCopilotDirs?: string[];
  /** Override: GitHub Copilot CLI logs directory (~/.copilot/logs) */
  copilotCliLogsDir?: string;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
  /** Callback invoked when a corrupted JSONL line is found in the queue */
  onCorruptLine?: OnCorruptLine;
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
    codex: number;
    cursor: number;
    gemini: number;
    opencode: number;
    openclaw: number;
    vscodeCopilot: number;
    copilotCli: number;
  };
  /** Total files scanned per source */
  filesScanned: {
    claude: number;
    codex: number;
    cursor: number;
    gemini: number;
    opencode: number;
    openclaw: number;
    vscodeCopilot: number;
    copilotCli: number;
  };
}

/** Internal bucket for aggregating deltas */
interface Bucket {
  source: Source;
  model: string;
  hourStart: string;
  tokens: TokenDelta;
}

/** Map Source type to short result key */
function sourceKey(source: Source): keyof SyncResult["sources"] {
  switch (source) {
    case "claude-code": return "claude";
    case "gemini-cli": return "gemini";
    case "opencode": return "opencode";
    case "openclaw": return "openclaw";
    case "codex": return "codex";
    case "cursor": return "cursor";
    case "vscode-copilot": return "vscodeCopilot";
    case "copilot-cli": return "copilotCli";
  }
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
  const queue = new LocalQueue(stateDir, opts.onCorruptLine);
  const cursors = await cursorStore.load();

  // Full-scan detection: if cursors were completely empty at start (first run
  // or after `pew reset`), all records represent the complete picture.
  const initialCursorEmpty =
    Object.keys(cursors.files).length === 0 && !cursors.openCodeSqlite;

  // Upgrade detection: cursors.json created before knownFilePaths was added
  // (pre-v1.6.0). We can't distinguish "cursor lost" from "new file" without
  // this field, so trigger a one-time full rescan to safely populate it.
  if (!initialCursorEmpty && !cursors.knownFilePaths) {
    onProgress?.({
      source: "all",
      phase: "warn",
      message: "Upgrading cursor format — one-time full rescan",
    });
    await cursorStore.save({
      version: 1,
      files: {},
      updatedAt: null,
    });
    return executeSync(opts);
  }

  // Backfill knownDbSources for cursors created between v1.6.0 (added
  // knownFilePaths) and this fix (added knownDbSources).
  //
  // If the openCodeSqlite cursor still exists, we can safely seed
  // knownDbSources from it. If the cursor is already gone AND other
  // cursors exist (!initialCursorEmpty), we can't distinguish "never
  // used SQLite" from "cursor lost" — trigger full rescan to be safe.
  // If the cursor is gone AND cursors are empty (first run / post-reset),
  // {} is safe because there's nothing to double-count.
  if (!cursors.knownDbSources) {
    if (cursors.openCodeSqlite) {
      cursors.knownDbSources = { openCodeSqlite: true };
    } else if (!initialCursorEmpty) {
      onProgress?.({
        source: "opencode-sqlite",
        phase: "warn",
        message: "Upgrading cursor format (DB) — one-time full rescan",
      });
      await cursorStore.save({
        version: 1,
        files: {},
        updatedAt: null,
      });
      return executeSync(opts);
    } else {
      cursors.knownDbSources = {};
    }
  }

  // Track whether a replay condition was detected during this scan.
  // Replay conditions include:
  //   1. File inode changed (file replaced/rotated) → driver reads from offset 0
  //   2. Cursor entry lost for a previously-scanned file → driver reads from 0
  //
  // In either case, the driver produces the full historical total for that
  // file. If we SUM this with the existing queue (which already contains
  // the same historical total), we get 2× inflation.
  //
  // When detected, we abort the current scan, clear all cursors, and
  // restart as a full scan (equivalent to `pew reset` + sync).
  let replayDetected = false;

  const allDeltas: ParsedDelta[] = [];
  const sourceCounts = { claude: 0, codex: 0, cursor: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0, copilotCli: 0 };
  const filesScanned = { claude: 0, codex: 0, cursor: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0, copilotCli: 0 };

  // Collect all discovered file paths (across all drivers) for knownFilePaths
  const discoveredFiles = new Set<string>();

  // Build driver sets from options
  const { fileDrivers, dbDrivers } = createTokenDrivers(opts);

  // Shared state bag for cross-driver communication
  const ctx: SyncContext = { dirMtimes: cursors.dirMtimes };

  // Discovery options bag (drivers read their relevant directory)
  const discoverOpts = {
    claudeDir: opts.claudeDir,
    codexSessionsDir: opts.codexSessionsDir,
    geminiDir: opts.geminiDir,
    openCodeMessageDir: opts.openCodeMessageDir,
    openCodeDbPath: opts.openCodeDbPath,
    openclawDir: opts.openclawDir,
    vscodeCopilotDirs: opts.vscodeCopilotDirs,
    copilotCliLogsDir: opts.copilotCliLogsDir,
  };

  // ---------- Phase 1: File-based drivers (generic loop) ----------
  for (const driver of fileDrivers) {
    const key = sourceKey(driver.source);

    onProgress?.({
      source: driver.source,
      phase: "discover",
      message: `Discovering ${driver.source} files...`,
    });

    const files = await driver.discover(discoverOpts, ctx);
    filesScanned[key] = files.length;
    for (const f of files) discoveredFiles.add(f);

    // Build discover message with skipped dirs info from context
    const skippedDirs = driver.source === "opencode" && ctx.dirMtimes
      ? Object.keys(ctx.dirMtimes).length
      : 0;
    const parseMsg = driver.source === "opencode" && skippedDirs > 0
      ? `Parsing ${files.length} ${driver.source} files (${skippedDirs} dirs skipped)...`
      : `Parsing ${files.length} ${driver.source} files...`;

    onProgress?.({
      source: driver.source,
      phase: "parse",
      total: files.length,
      message: parseMsg,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const fingerprint: FileFingerprint = {
        inode: st.ino,
        mtimeMs: st.mtimeMs,
        size: st.size,
      };

      const cursor = cursors.files[filePath] as FileCursorBase | undefined;

      // Fast skip: file unchanged since last cursor?
      if (driver.shouldSkip(cursor, fingerprint)) {
        onProgress?.({
          source: driver.source,
          phase: "parse",
          current: i + 1,
          total: files.length,
        });
        continue;
      }

      // Detect replay conditions that would cause SUM inflation:
      //
      // 1. Inode change: file was replaced/rotated → driver replays from 0.
      // 2. Cursor entry lost: the cursor for a previously-scanned file was
      //    deleted or corrupted → driver treats it as new and reads from 0.
      //
      // Condition 2 uses `knownFilePaths` to distinguish "cursor lost for a
      // known file" (replay risk) from "genuinely new file" (safe to SUM).
      //
      // In both cases, SUM'ing a full replay with the existing queue would
      // double-count. Abort and restart as full scan.
      if (!initialCursorEmpty) {
        if (cursor && cursor.inode !== fingerprint.inode) {
          replayDetected = true;
          onProgress?.({
            source: driver.source,
            phase: "warn",
            message: `File inode changed for ${filePath} — restarting as full scan`,
          });
          break;
        }
        if (!cursor && cursors.knownFilePaths?.[filePath]) {
          replayDetected = true;
          onProgress?.({
            source: driver.source,
            phase: "warn",
            message: `Cursor entry lost for known file ${filePath} — restarting as full scan`,
          });
          break;
        }
      }

      // Extract resume state and parse
      const resume = driver.resumeState(cursor, fingerprint);
      const result = await driver.parse(filePath, resume).catch(
        (err: unknown) => {
          onProgress?.({
            source: driver.source,
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return null;
        },
      );
      if (!result) continue;

      // Build and persist cursor (cast: driver returns concrete cursor type
      // but the generic loop types it as FileCursorBase)
      cursors.files[filePath] = driver.buildCursor(fingerprint, result, cursor) as FileCursor;

      // Collect deltas
      allDeltas.push(...result.deltas);
      sourceCounts[key] += result.deltas.length;

      onProgress?.({
        source: driver.source,
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }

    // Post-parse hook (e.g. OpenCode JSON deposits messageKeys into ctx)
    driver.afterAll?.(cursors.files, ctx);

    // If inode change detected in inner loop, break outer driver loop too
    if (replayDetected) break;
  }

  // ---------- Replay condition → full rescan restart ----------
  // A file inode change or lost cursor entry means the driver would replay
  // from offset 0, but we're in incremental mode — SUM'ing would inflate.
  // Strategy: clear all cursors and restart as a clean full scan.
  if (replayDetected) {
    onProgress?.({
      source: "all",
      phase: "warn",
      message: "Replay condition detected — clearing cursors and restarting full scan",
    });
    await cursorStore.save({
      version: 1,
      files: {},
      updatedAt: null,
    });
    return executeSync(opts);
  }

  // ---------- Phase 2: DB-based drivers ----------
  // SQLite warning paths are handled at the orchestrator level because:
  // - "SQLite not available": registry doesn't create a driver (no openMessageDb)
  // - "Failed to open": factory returns null, driver would silently return empty
  // We pre-probe the factory here to emit warnings BEFORE running the driver,
  // avoiding the need for double-open detection after the fact.
  let activeDbDrivers = dbDrivers;
  if (opts.openCodeDbPath) {
    const dbStat = await stat(opts.openCodeDbPath).catch(() => null);
    if (dbStat) {
      if (!opts.openMessageDb) {
        // Case 1: DB file exists but SQLite adapter is missing (native module not available)
        onProgress?.({
          source: "opencode-sqlite",
          phase: "discover",
          message: "Checking OpenCode SQLite database...",
        });
        onProgress?.({
          source: "opencode-sqlite",
          phase: "warn",
          message: `OpenCode SQLite database found at ${opts.openCodeDbPath} but SQLite is not available — SQLite token data will NOT be synced`,
        });
      } else {
        // Case 2: Both provided — pre-probe if factory returns null
        const handle = opts.openMessageDb(opts.openCodeDbPath);
        if (!handle) {
          onProgress?.({
            source: "opencode-sqlite",
            phase: "discover",
            message: "Checking OpenCode SQLite database...",
          });
          onProgress?.({
            source: "opencode-sqlite",
            phase: "warn",
            message: `Failed to open OpenCode SQLite database at ${opts.openCodeDbPath} — SQLite token data will NOT be synced`,
          });
          // Skip DB drivers — factory returns null, driver would return empty anyway
          activeDbDrivers = [];
        } else {
          handle.close();
        }
      }
    }
  }

  for (const driver of activeDbDrivers) {
    const key = sourceKey(driver.source);

    onProgress?.({
      source: "opencode-sqlite",
      phase: "discover",
      message: "Checking OpenCode SQLite database...",
    });

    const prevCursor = cursors.openCodeSqlite as OpenCodeSqliteCursor | undefined;

    // Detect DB cursor loss (parallel to file-based knownFilePaths logic):
    // If the DB was previously synced (tracked in knownDbSources) but the
    // cursor entry is missing, the driver will replay from rowId 0 — SUM'ing
    // that with the existing queue would double-count. Trigger full rescan.
    if (!initialCursorEmpty && !prevCursor && cursors.knownDbSources?.["openCodeSqlite"]) {
      onProgress?.({
        source: "opencode-sqlite",
        phase: "warn",
        message: "SQLite cursor entry lost — restarting as full scan",
      });
      await cursorStore.save({
        version: 1,
        files: {},
        updatedAt: null,
      });
      return executeSync(opts);
    }

    const result = await driver.run(prevCursor, ctx);

    // Detect DB inode change (same logic as file drivers)
    const dbCursor = result.cursor as OpenCodeSqliteCursor;
    if (
      !initialCursorEmpty &&
      prevCursor &&
      dbCursor.inode !== prevCursor.inode
    ) {
      onProgress?.({
        source: "opencode-sqlite",
        phase: "warn",
        message: "SQLite database inode changed — restarting full scan",
      });
      await cursorStore.save({
        version: 1,
        files: {},
        updatedAt: null,
      });
      return executeSync(opts);
    }

    cursors.openCodeSqlite = result.cursor as CursorState["openCodeSqlite"];

    // Track this DB source as "previously synced" for cursor-loss detection
    const knownDb: Record<string, true> = cursors.knownDbSources ?? {};
    knownDb["openCodeSqlite"] = true;
    cursors.knownDbSources = knownDb;

    allDeltas.push(...result.deltas);
    sourceCounts[key] += result.deltas.length;

    const dedupSkipped = result.rowCount - (result.deltas.length > 0 ? result.deltas.length : 0);
    onProgress?.({
      source: "opencode-sqlite",
      phase: "parse",
      message: `Parsed ${result.deltas.length} deltas from ${result.rowCount} SQLite rows${dedupSkipped > 0 ? ` (${dedupSkipped} deduped)` : ""}`,
    });
  }

  // Persist context state
  cursors.dirMtimes = ctx.dirMtimes;

  // Update knownFilePaths: merge newly discovered files with existing set.
  // This grows monotonically — files are never removed from knownFilePaths
  // even if the physical file is deleted, because we only need to know
  // "was this path ever scanned?" for cursor-loss detection.
  const known: Record<string, true> = cursors.knownFilePaths ?? {};
  for (const fp of discoveredFiles) known[fp] = true;
  cursors.knownFilePaths = known;

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

    const bk = bucketKey(delta.source, delta.model, hourStart);
    let bucket = buckets.get(bk);
    if (!bucket) {
      bucket = {
        source: delta.source,
        model: delta.model,
        hourStart,
        tokens: emptyTokenDelta(),
      };
      buckets.set(bk, bucket);
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
      device_id: opts.deviceId,
      input_tokens: bucket.tokens.inputTokens,
      cached_input_tokens: bucket.tokens.cachedInputTokens,
      output_tokens: bucket.tokens.outputTokens,
      reasoning_output_tokens: bucket.tokens.reasoningOutputTokens,
      total_tokens: totalTokens,
    });
  }

  // ---------- Write to queue (overwrite, not append) ----------
  // Design note: this is O(total_queue) not O(delta), which is intentional.
  //
  // Records are aggregated buckets keyed by (source, model, hour_start,
  // device_id).  Practical size is bounded: ~tools × models × hours × devices,
  // typically a few hundred rows (<1 MB) for a single user.  The overwrite +
  // offset-reset pattern guarantees idempotent upload: the server upserts via
  // ON CONFLICT … DO UPDATE SET, so re-sending the full queue is safe and
  // ensures eventual consistency even if a previous upload was partial.
  //
  // Full scan (empty cursors): records are the complete picture from all log
  // files → overwrite queue entirely (discard any stale accumulated values).
  //
  // Incremental (cursors exist): records are deltas since last sync → SUM
   // with existing queue contents to accumulate across multiple sync cycles
   // that haven't been uploaded yet.
   //
   // Dirty-key tracking: each branch saves the set of bucket keys that were
   // modified in this sync cycle. The upload engine uses dirtyKeys to filter
   // which records actually need sending, avoiding full re-upload on every sync.
  if (initialCursorEmpty) {
    // Full scan: overwrite queue with complete snapshot
    await queue.overwrite(records);
    await queue.saveOffset(0);
    // All records are dirty (fresh full scan)
    const newKeys = records.map(
      (r) => `${r.source}|${r.model}|${r.hour_start}|${r.device_id}`,
    );
    await queue.saveDirtyKeys([...new Set(newKeys)]);
  } else if (records.length > 0) {
    // Incremental with new data: SUM with existing queue records
    const { records: oldRecords } = await queue.readFromOffset(0);
    const merged = aggregateRecords([...oldRecords, ...records]);
    await queue.overwrite(merged);
    await queue.saveOffset(0);
    // Union new bucket keys into existing dirtyKeys
    const newKeys = records.map(
      (r) => `${r.source}|${r.model}|${r.hour_start}|${r.device_id}`,
    );
    const existingDirty = (await queue.loadDirtyKeys()) ?? [];
    const unionSet = new Set([...existingDirty, ...newKeys]);
    await queue.saveDirtyKeys([...unionSet]);
  }
  // else: incremental with no new data — skip queue write entirely
  // to preserve the upload offset and dirtyKeys (Bug B: re-marking uploaded records)

  // ---------- Save cursor state AFTER queue ----------
  // Queue must be written before cursor so that a crash between the two
  // does not lose data. Worst case: queue overwritten + cursor not saved
  // → next sync re-scans from old cursor position → produces a superset
  // of the current records → overwrite queue → values ≥ true (minor
  // over-count for one sync cycle, recoverable via pew reset).
  cursors.updatedAt = new Date().toISOString();
  await cursorStore.save(cursors);

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

import { stat } from "node:fs/promises";
import type {
  CodexScopeState,
  CursorState,
  FileCursor,
  FileCursorBase,
  HermesSqliteCursor,
  QueueRecord,
  Source,
  TokenDelta,
} from "@pew/core";

/**
 * Local copy of @pew/core's ACCOUNTING_SCHEMA_VERSION. @pew/core is a
 * types-only package classified as devDependency, so runtime `import
 * { ... }` from it breaks in published npm installs where devDeps are
 * absent. Keep this in sync with packages/core/src/types.ts.
 */
const ACCOUNTING_SCHEMA_VERSION = 2;
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import { pruneAliasCursors } from "../storage/prune-alias-cursors.js";
import type { OnCorruptLine } from "../storage/base-queue.js";
import type { QueryMessagesFn } from "../parsers/opencode-sqlite.js";
import type { QuerySessionsFn } from "../parsers/hermes-sqlite.js";
import type { ZcodeUsageDb } from "../parsers/zcode-types.js";
import type { ParsedDelta } from "../parsers/claude.js";
import { toUtcHalfHourStart, bucketKey, addTokens, emptyTokenDelta } from "../utils/buckets.js";
import { createTokenDrivers } from "../drivers/registry.js";
import type { SyncContext, FileFingerprint } from "../drivers/types.js";
import {
  applyResumeStartOffset,
  isOffsetCursor,
  readContinuityAnchors,
  resolveJsonlContinuity,
  usesJsonlOffsetResume,
} from "../utils/continuity-anchor.js";
import { parserSawSmallerSnapshot } from "../utils/jsonl-offset.js";
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
  /** Override: Multica Codex extra session directories */
  multicaCodexDirs?: string[];
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
  /** Override: Oh My Pi session directory (~/.omp/agent/sessions) */
  ompSessionsDir?: string;
  /** Override: Pi session directory (~/.pi/agent/sessions) */
  piSessionsDir?: string;
  /** Override: VSCode Copilot base directories (stable + insiders) */
  vscodeCopilotDirs?: string[];
  /** Override: GitHub Copilot CLI logs directory (~/.copilot/logs) */
  copilotCliLogsDir?: string;
  /** Copilot OTel exporter files or recursively scanned directories */
  copilotCliOtelPaths?: string[];
  /** Override: Hermes Agent database path (~/.hermes/state.db) */
  hermesDbPath?: string;
  /** Override: Hermes profile database paths (~/.hermes/profiles/<name>/state.db) */
  hermesProfileDbPaths?: Array<{ dbPath: string; dbKey: string }>;
  /** Factory for opening the Hermes SQLite DB (DI for testability) */
  openHermesDb?: (dbPath: string) => { querySessions: QuerySessionsFn; close: () => void } | null;
  /** Override: Kosmos data directory (kosmos-app) */
  kosmosDataDir?: string;
  /** Override: PM Studio data directory (pm-studio-app) */
  pmstudioDataDir?: string;
  /** Override: Grok CLI unified log path (~/.grok/logs/unified.jsonl) */
  grokLogsPath?: string;
  /** Override: Grok CLI sessions directory (~/.grok/sessions) */
  grokSessionsDir?: string;
  /** Override: ZCode CLI SQLite database path (~/.zcode/cli/db/db.sqlite) */
  zcodeDbPath?: string;
  /** Factory for opening the ZCode SQLite DB for tokens (DI for testability) */
  openZcodeDb?: (dbPath: string) => ZcodeUsageDb | null;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
  /** Callback invoked when a corrupted JSONL line is found in the queue */
  onCorruptLine?: OnCorruptLine;
}

interface InternalSyncOptions extends SyncOptions {
  /**
   * Previous full queue snapshot retained across an accounting-schema rescan.
   * Missing buckets are emitted as zero-value tombstones so overwrite upserts
   * also clear historical server rows that the corrected parser no longer
   * produces.
   */
  reconcilePreviousQueueRecords?: QueueRecord[];
}

/** Progress event for UI display */
interface ProgressEvent {
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
    gemini: number;
    grok: number;
    kosmos: number;
    omp: number;
    opencode: number;
    openclaw: number;
    pi: number;
    pmstudio: number;
    vscodeCopilot: number;
    copilotCli: number;
    hermes: number;
    zcode: number;
  };
  /** Total files scanned per source */
  filesScanned: {
    claude: number;
    codex: number;
    gemini: number;
    grok: number;
    kosmos: number;
    omp: number;
    opencode: number;
    openclaw: number;
    pi: number;
    pmstudio: number;
    vscodeCopilot: number;
    copilotCli: number;
    hermes: number;
    zcode: number;
  };
  /** Total SQLite databases scanned per source */
  dbsScanned: {
    opencode: number;
    hermes: number;
    zcode: number;
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
    case "grok": return "grok";
    case "kosmos": return "kosmos";
    case "omp": return "omp";
    case "opencode": return "opencode";
    case "openclaw": return "openclaw";
    case "pi": return "pi";
    case "pmstudio": return "pmstudio";
    case "codex": return "codex";
    case "vscode-copilot": return "vscodeCopilot";
    case "copilot-cli": return "copilotCli";
    case "hermes": return "hermes";
    case "zcode": return "zcode";
    default: {
      // Exhaustiveness check — if Source adds a new value, this will fail to compile
      const _exhaustive: never = source;
      throw new Error(`Unknown source: ${_exhaustive}`);
    }
  }
}

function emptyEpochCursor(
  _cursor: FileCursorBase & { offset: number },
  fingerprint: FileFingerprint,
): FileCursor {
  return {
    inode: fingerprint.inode,
    mtimeMs: fingerprint.mtimeMs,
    size: 0,
    offset: 0,
    continuityAnchors: [],
    continuityBroken: undefined,
    updatedAt: new Date().toISOString(),
    seenIds: [],
    lastTotals: null,
    lastModel: null,
    scopeId: null,
    processedRequestIndices: [],
    requestMeta: {},
    processedRequestIds: [],
  } as FileCursor;
}

/**
 * Execute the sync operation: discover files, parse incrementally,
 * aggregate into half-hour buckets, and write to local queue.
 *
 * Pure logic — no CLI I/O. Receives all dependencies via options.
 */
export async function executeSync(opts: SyncOptions): Promise<SyncResult> {
  return executeSyncInternal(opts);
}

async function executeSyncInternal(opts: InternalSyncOptions): Promise<SyncResult> {
  const { stateDir, onProgress } = opts;

  const cursorStore = new CursorStore(stateDir);
  const queue = new LocalQueue(stateDir, opts.onCorruptLine);
  const cursors = await cursorStore.load();

  // Migrate hermesSqlite from flat object (pre-multi-profile) to Record format.
  // Old cursors.json: { hermesSqlite: { sessionTotals: {...}, inode: N, updatedAt: "..." } }
  // New cursors.json: { hermesSqlite: { "default": { sessionTotals: {...}, ... } } }
  // Detection: if hermesSqlite exists and has `sessionTotals` at top level, it's old format.
  if (cursors.hermesSqlite && "sessionTotals" in cursors.hermesSqlite) {
    const oldCursor = cursors.hermesSqlite as unknown as HermesSqliteCursor;
    cursors.hermesSqlite = { default: oldCursor };
    onProgress?.({
      source: "hermes",
      phase: "warn",
      message: "Migrating Hermes cursor to multi-profile format",
    });
  }

  // Helper to check if hermesSqlite Record is effectively empty
  const isHermesCursorsEmpty = () => {
    if (!cursors.hermesSqlite) return true;
    return Object.keys(cursors.hermesSqlite).length === 0;
  };

  // Full-scan detection: if cursors were completely empty at start (first run
  // or after `pew reset`), all records represent the complete picture.
  const initialCursorEmpty =
    Object.keys(cursors.files).length === 0 &&
    !cursors.openCodeSqlite &&
    isHermesCursorsEmpty();

  // Token accounting schema upgrade (global): when any source changes how
  // TokenDeltas are normalized (e.g. inclusive → disjoint for codex /
  // copilot-cli / grok), replaying only new bytes would SUM-mix old and new
  // semantics. One-time wipe + full rescan overwrites the queue cleanly.
  if (
    !initialCursorEmpty &&
    (cursors.accountingSchemaVersion ?? 0) < ACCOUNTING_SCHEMA_VERSION
  ) {
    onProgress?.({
      source: "all",
      phase: "warn",
      message: `Token accounting schema v${ACCOUNTING_SCHEMA_VERSION} — one-time full rescan`,
    });
    const { records: previousQueueRecords } = await queue.readFromOffset(0);
    await cursorStore.save({
      version: 1,
      accountingSchemaVersion: ACCOUNTING_SCHEMA_VERSION,
      files: {},
      knownFilePaths: {},
      knownDbSources: {},
      updatedAt: null,
    });
    return executeSyncInternal({
      ...opts,
      reconcilePreviousQueueRecords: previousQueueRecords,
    });
  }

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
      accountingSchemaVersion: ACCOUNTING_SCHEMA_VERSION,
      files: {},
      updatedAt: null,
    });
    return executeSyncInternal(opts);
  }

  // Backfill knownDbSources for cursors created between v1.6.0 (added
  // knownFilePaths) and this fix (added knownDbSources).
  //
  // If any DB cursor (openCodeSqlite / hermesSqlite) still exists, we can
  // safely seed knownDbSources from it. If all cursors are already gone AND
  // other cursors exist (!initialCursorEmpty), we can't distinguish "never
  // used SQLite" from "cursor lost" — trigger full rescan to be safe.
  // If cursors are empty (first run / post-reset), {} is safe because
  // there's nothing to double-count.
  if (!cursors.knownDbSources) {
    const dbCursorsExist = cursors.openCodeSqlite || !isHermesCursorsEmpty() || cursors.zcodeSqlite;
    if (dbCursorsExist) {
      cursors.knownDbSources = {};
      if (cursors.openCodeSqlite) cursors.knownDbSources.openCodeSqlite = true;
      // Track each Hermes DB key (e.g. "hermesSqlite:default", "hermesSqlite:profiles/tomato")
      if (cursors.hermesSqlite) {
        for (const dbKey of Object.keys(cursors.hermesSqlite)) {
          cursors.knownDbSources[`hermesSqlite:${dbKey}`] = true;
        }
      }
      if (cursors.zcodeSqlite) cursors.knownDbSources.zcodeSqlite = true;
    } else if (!initialCursorEmpty) {
      onProgress?.({
        source: "all",
        phase: "warn",
        message: "Upgrading cursor format (DB) — one-time full rescan",
      });
      await cursorStore.save({
        version: 1,
        accountingSchemaVersion: ACCOUNTING_SCHEMA_VERSION,
        files: {},
        updatedAt: null,
      });
      return executeSyncInternal(opts);
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
  const sourceCounts = { claude: 0, codex: 0, copilotCli: 0, gemini: 0, grok: 0, hermes: 0, kosmos: 0, omp: 0, opencode: 0, openclaw: 0, pi: 0, pmstudio: 0, vscodeCopilot: 0, zcode: 0 };
  const filesScanned = { claude: 0, codex: 0, copilotCli: 0, gemini: 0, grok: 0, hermes: 0, kosmos: 0, omp: 0, opencode: 0, openclaw: 0, pi: 0, pmstudio: 0, vscodeCopilot: 0, zcode: 0 };
  const dbsScanned = { opencode: 0, hermes: 0, zcode: 0 };

  // Collect all discovered file paths (across all drivers) for knownFilePaths
  const discoveredFiles = new Set<string>();
  // Subset of discoveredFiles where the parse loop could NOT confirm a
  // valid cursor this run — either stat() failed before parse, or the
  // parser itself threw. We track failures (not successes) because
  // `shouldSkip` fast-skips already-up-to-date cursors without writing
  // them, and those should also count as "cursor is correct as of now".
  // discoveredFiles \ parseFailedPaths = cursor-valid paths for this run.
  const parseFailedPaths = new Set<string>();

  // Codex rescan health, consumed by the accounting-migration reconciliation
  // below. Codex only qualifies as "fully rescanned" when it discovered at
  // least one rollout and every one of them parsed cleanly.
  let codexFilesDiscovered = 0;
  let codexParseFailures = 0;

  // Build driver sets from options
  const { fileDrivers, dbDrivers } = createTokenDrivers(opts);

  // Shared state bag for cross-driver communication.
  //
  // Codex scope state is seeded from (and written back to) CursorState.codexScopes
  // rather than per-file cursors: a Goal continuation replays one cumulative
  // counter across many rollouts, and the rollout that first observed an edge is
  // routinely pruned before its siblings. Per-file storage lost the edge with the
  // file, so the next replay counted it again.
  const ctx: SyncContext = { dirMtimes: cursors.dirMtimes };
  const persistedScopes = cursors.codexScopes ?? {};
  ctx.codexScopeTotals = new Map(
    Object.entries(persistedScopes)
      .filter((entry): entry is [string, { totals: TokenDelta; usageKeys: string[] }] =>
        entry[1].totals !== null,
      )
      .map(([scopeId, scope]) => [scopeId, scope.totals]),
  );
  ctx.codexSeenUsageKeys = new Map(
    Object.entries(persistedScopes).map(([scopeId, scope]) => [
      scopeId,
      new Set(scope.usageKeys),
    ]),
  );
  ctx.codexKnownScopes = Object.fromEntries(
    Object.entries(cursors.files).flatMap(([filePath, cursor]) => {
      const scopeId = (cursor as { scopeId?: string | null }).scopeId;
      return scopeId ? [[filePath, scopeId] as const] : [];
    }),
  );

  // Discovery options bag (drivers read their relevant directory)
  const discoverOpts = {
    claudeDir: opts.claudeDir,
    codexSessionsDir: opts.codexSessionsDir,
    multicaCodexDirs: opts.multicaCodexDirs,
    geminiDir: opts.geminiDir,
    kosmosDataDir: opts.kosmosDataDir,
    pmstudioDataDir: opts.pmstudioDataDir,
    ompSessionsDir: opts.ompSessionsDir,
    openCodeMessageDir: opts.openCodeMessageDir,
    openCodeDbPath: opts.openCodeDbPath,
    openclawDir: opts.openclawDir,
    piSessionsDir: opts.piSessionsDir,
    vscodeCopilotDirs: opts.vscodeCopilotDirs,
    copilotCliLogsDir: opts.copilotCliLogsDir,
    copilotCliOtelPaths: opts.copilotCliOtelPaths,
    grokLogsPath: opts.grokLogsPath,
    grokSessionsDir: opts.grokSessionsDir,
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

    // Optional pre-loop hook: let the driver lift persisted per-file state
    // (dedup rings, etc.) into ctx before any file is fast-skipped. Without
    // this, an unchanged file's cursor never contributes to cross-file
    // dedup on this sync run.
    driver.preload?.(cursors.files, ctx);

    // Pre-loop replay scan: some cursor formats (e.g. legacy Claude entries
    // without a seenIds ring) require a full-sync restart before ANY of
    // this driver's files are touched. Checking inside the per-file loop
    // would be too late — an unchanged legacy file hits fast-skip and
    // never gets to needsReplay, but its stale cursor still poisons dedup
    // for the driver's OTHER files during this run.
    //
    // IMPORTANT: only inspect paths discovered by THIS driver (`files`).
    // Using the global `discoveredFiles` set would pass Claude cursors to
    // codex.needsReplay (and vice versa) and false-trigger full rescans.
    if (!initialCursorEmpty && driver.needsReplay) {
      const ownedFiles = new Set(files);
      for (const [path, cursor] of Object.entries(cursors.files)) {
        if (!ownedFiles.has(path)) continue;
        if (driver.needsReplay(cursor as FileCursorBase)) {
          replayDetected = true;
          onProgress?.({
            source: driver.source,
            phase: "warn",
            message: `Legacy cursor for ${path} — restarting as full scan`,
          });
          break;
        }
      }
      if (replayDetected) break;
    }

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
    if (driver.source === "codex") codexFilesDiscovered += files.length;

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const st = await stat(filePath).catch(() => null);
      if (!st) {
        // File vanished between discover and stat. Track as failed so the
        // post-loop cursor bookkeeping treats it the same as a parse
        // throw: do NOT mark it freshly-synced (would seed a known-only
        // stale entry).
        parseFailedPaths.add(filePath);
        if (driver.source === "codex") codexParseFailures++;
        continue;
      }

      const fingerprint: FileFingerprint = {
        inode: st.ino,
        mtimeMs: st.mtimeMs,
        size: st.size,
      };

      const cursor = cursors.files[filePath] as FileCursorBase | undefined;
      const offsetCursor = isOffsetCursor(cursor) ? cursor : undefined;
      const poisonedOffset =
        !!offsetCursor && offsetCursor.offset > fingerprint.size;

      // Fast skip: file unchanged since last cursor?
      // A cursor whose offset is already past EOF is never unchanged — the
      // next pass must run continuity instead of refreshing a poisoned offset.
      if (!poisonedOffset && driver.shouldSkip(cursor, fingerprint)) {
        if (
          offsetCursor &&
          usesJsonlOffsetResume(driver.source, filePath) &&
          fingerprint.size === 0
        ) {
          cursors.files[filePath] = emptyEpochCursor(offsetCursor, fingerprint);
          onProgress?.({
            source: driver.source,
            phase: "parse",
            current: i + 1,
            total: files.length,
          });
          continue;
        }
        if (
          offsetCursor &&
          usesJsonlOffsetResume(driver.source, filePath) &&
          (!offsetCursor.continuityAnchors ||
            offsetCursor.continuityAnchors.length === 0)
        ) {
          try {
            const stamped = await readContinuityAnchors(
              filePath,
              offsetCursor.offset,
            );
            if (stamped && stamped.length > 0) {
              offsetCursor.continuityAnchors = stamped;
              cursors.files[filePath] = offsetCursor as FileCursor;
            }
          } catch {
            // Best-effort migration; a later changed-file pass will retry.
          }
        }
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
      // (A third condition — driver-declared legacy replay — is checked
      // BEFORE this loop, in the pre-loop replay scan above, because an
      // unchanged legacy cursor would fast-skip and never reach here.)
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

      // Same-inode JSONL trim/rewrite: rebase to the last proven record
      // instead of SUM-replaying a retained tail or wiping every source.
      const jsonlSource = usesJsonlOffsetResume(driver.source, filePath);
      if (offsetCursor && jsonlSource && fingerprint.size === 0) {
        cursors.files[filePath] = emptyEpochCursor(offsetCursor, fingerprint);
        continue;
      }

      const resume = driver.resumeState(cursor, fingerprint);
      if (offsetCursor && jsonlSource) {
        const decision = await resolveJsonlContinuity({
          filePath,
          fileSize: fingerprint.size,
          cursorSize: offsetCursor.size,
          offset: offsetCursor.offset,
          anchors: offsetCursor.continuityAnchors,
        });
        if (decision.action === "skip") {
          onProgress?.({
            source: driver.source,
            phase: "warn",
            message: `JSONL log continuity lost for ${driver.source}; skipping ${filePath} to avoid double-counting`,
          });
          cursors.files[filePath] = {
            ...offsetCursor,
            inode: fingerprint.inode,
            mtimeMs: fingerprint.mtimeMs,
            size: fingerprint.size,
            offset: Math.min(offsetCursor.offset, fingerprint.size),
            continuityBroken: true,
            updatedAt: new Date().toISOString(),
          } as FileCursor;
          continue;
        }
        applyResumeStartOffset(resume, decision.startOffset);
      }

      const result = await driver.parse(filePath, resume, ctx).catch(
        (err: unknown) => {
          onProgress?.({
            source: driver.source,
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return null;
        },
      );
      if (!result) {
        parseFailedPaths.add(filePath);
        if (driver.source === "codex") codexParseFailures++;
        continue;
      }

      const built = driver.buildCursor(fingerprint, result, cursor) as FileCursor;
      if (
        jsonlSource &&
        isOffsetCursor(built) &&
        parserSawSmallerSnapshot(result.deltas.length, built.offset, fingerprint.size)
      ) {
        parseFailedPaths.add(filePath);
        if (driver.source === "codex") codexParseFailures++;
        continue;
      }
      if (jsonlSource && isOffsetCursor(built)) {
        if (built.offset > fingerprint.size) {
          built.size = built.offset;
        }
        const anchors = await readContinuityAnchors(filePath, built.offset);
        if (anchors !== null) {
          built.continuityAnchors = anchors;
          built.continuityBroken = undefined;
        }
      }
      cursors.files[filePath] = built;

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
      accountingSchemaVersion: ACCOUNTING_SCHEMA_VERSION,
      files: {},
      updatedAt: null,
    });
    return executeSyncInternal(opts);
  }

  // ---------- Phase 2: DB-based drivers ----------
  // SQLite warning paths are handled at the orchestrator level because:
  // - "SQLite not available": registry doesn't create a driver (no openMessageDb/openHermesDb)
  // - "Failed to open": factory returns null, driver would silently return empty
  // We pre-probe the factory here to emit warnings BEFORE running the driver,
  // avoiding the need for double-open detection after the fact.
  let activeDbDrivers = dbDrivers;

  // OpenCode pre-check
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
        // Skip only OpenCode driver, keep other DB drivers (e.g. Hermes)
        activeDbDrivers = activeDbDrivers.filter((d) => d.source !== "opencode");
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
          // Skip only OpenCode driver, keep other DB drivers (e.g. Hermes)
          activeDbDrivers = activeDbDrivers.filter((d) => d.source !== "opencode");
        } else {
          handle.close();
        }
      }
    }
  }

  // Hermes pre-check: validate all Hermes DBs (default + profiles)
  // Build a list of valid DB paths for filtering drivers
  const validHermesDbKeys = new Set<string>();
  const allHermesDbs: Array<{ dbPath: string; dbKey: string }> = [];
  if (opts.hermesDbPath) {
    allHermesDbs.push({ dbPath: opts.hermesDbPath, dbKey: "default" });
  }
  if (opts.hermesProfileDbPaths) {
    allHermesDbs.push(...opts.hermesProfileDbPaths);
  }

  for (const { dbPath, dbKey } of allHermesDbs) {
    const dbStat = await stat(dbPath).catch(() => null);
    if (dbStat) {
      if (!opts.openHermesDb) {
        // Case 1: DB file exists but SQLite adapter is missing
        onProgress?.({
          source: "hermes",
          phase: "warn",
          message: `Hermes SQLite database found at ${dbPath} but SQLite is not available — Hermes token data will NOT be synced`,
        });
        // Don't add to validHermesDbKeys - driver will be filtered out
      } else {
        // Case 2: Both provided — pre-probe if factory returns null
        const handle = opts.openHermesDb(dbPath);
        if (!handle) {
          onProgress?.({
            source: "hermes",
            phase: "warn",
            message: `Failed to open Hermes SQLite database at ${dbPath} — Hermes token data will NOT be synced`,
          });
          // Don't add to validHermesDbKeys - driver will be filtered out
        } else {
          handle.close();
          validHermesDbKeys.add(dbKey);
        }
      }
    }
  }

  // ZCode pre-check: only filter zcode driver on failure; leave OpenCode /
  // Hermes drivers intact. See docs/43-zcode-support.md §二挑战 7.
  if (opts.zcodeDbPath) {
    const dbStat = await stat(opts.zcodeDbPath).catch(() => null);
    if (dbStat) {
      if (!opts.openZcodeDb) {
        onProgress?.({
          source: "zcode-sqlite",
          phase: "warn",
          message: `ZCode SQLite database found at ${opts.zcodeDbPath} but SQLite is not available — ZCode token data will NOT be synced`,
        });
        activeDbDrivers = activeDbDrivers.filter((d) => d.source !== "zcode");
      } else {
        const handle = opts.openZcodeDb(opts.zcodeDbPath);
        if (!handle) {
          onProgress?.({
            source: "zcode-sqlite",
            phase: "warn",
            message: `Failed to open ZCode SQLite database at ${opts.zcodeDbPath} — ZCode token data will NOT be synced`,
          });
          activeDbDrivers = activeDbDrivers.filter((d) => d.source !== "zcode");
        } else {
          handle.close();
        }
      }
    }
  }

  // Filter out Hermes drivers that failed pre-check
  activeDbDrivers = activeDbDrivers.filter((d) => {
    if (d.source !== "hermes") return true;
    // Hermes drivers have dbKey property
    const hermesDriver = d as typeof d & { dbKey?: string };
    return hermesDriver.dbKey && validHermesDbKeys.has(hermesDriver.dbKey);
  });

  for (const driver of activeDbDrivers) {
    const key = sourceKey(driver.source);
    const isOpenCode = driver.source === "opencode";
    const isHermes = driver.source === "hermes";
    const isZcode = driver.source === "zcode";

    // For Hermes, extract dbKey from the driver instance
    const hermesDbKey = isHermes
      ? (driver as typeof driver & { dbKey: string }).dbKey
      : null;

    // Display name for progress messages
    const displayName = isOpenCode
      ? "OpenCode SQLite"
      : hermesDbKey
        ? `Hermes SQLite (${hermesDbKey})`
        : isHermes
          ? "Hermes SQLite"
          : isZcode
            ? "ZCode SQLite"
            : `${driver.source} SQLite`;

    onProgress?.({
      source: driver.source,
      phase: "discover",
      message: `Checking ${displayName} database...`,
    });

    // Get previous cursor based on driver type
    let prevCursor: unknown;
    if (isOpenCode) {
      prevCursor = cursors.openCodeSqlite;
    } else if (isHermes && hermesDbKey) {
      // Hermes uses Record<dbKey, HermesSqliteCursor>
      prevCursor = cursors.hermesSqlite?.[hermesDbKey];
    } else if (isZcode) {
      prevCursor = cursors.zcodeSqlite;
    }

    // Detect DB cursor loss (parallel to file-based knownFilePaths logic):
    // If the DB was previously synced (tracked in knownDbSources) but the
    // cursor entry is missing, the driver will replay from rowId 0 — SUM'ing
    // that with the existing queue would double-count. Trigger full rescan.
    const dbSourceKey = isOpenCode
      ? "openCodeSqlite"
      : isHermes
        ? `hermesSqlite:${hermesDbKey}`
        : isZcode
          ? "zcodeSqlite"
          : `${driver.source}Sqlite`;

    if (!initialCursorEmpty && !prevCursor && cursors.knownDbSources?.[dbSourceKey]) {
      onProgress?.({
        source: driver.source,
        phase: "warn",
        message: `${displayName} cursor entry lost — restarting as full scan`,
      });
      await cursorStore.save({
        version: 1,
        accountingSchemaVersion: ACCOUNTING_SCHEMA_VERSION,
        files: {},
        updatedAt: null,
      });
      return executeSyncInternal(opts);
    }

    let result: Awaited<ReturnType<typeof driver.run>>;
    try {
      result = await driver.run(prevCursor, ctx);
    } catch (err) {
      onProgress?.({
        source: driver.source,
        phase: "warn",
        message: `Skipping ${displayName}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue; // Skip this DB source, continue with others
    }

    // Forward non-fatal warnings from the driver (e.g. zcode provider_total
    // mismatch). Adapter never emits without a run() call, so this runs
    // after the try/catch above.
    for (const w of result.warnings ?? []) {
      onProgress?.({
        source: driver.source,
        phase: "warn",
        message: w,
      });
    }

    // Detect DB inode change (same logic as file drivers)
    const dbCursor = result.cursor as { inode?: number };
    if (
      !initialCursorEmpty &&
      prevCursor &&
      dbCursor.inode !== undefined &&
      (prevCursor as { inode?: number }).inode !== undefined &&
      dbCursor.inode !== (prevCursor as { inode?: number }).inode
    ) {
      onProgress?.({
        source: driver.source,
        phase: "warn",
        message: `${displayName} inode changed — restarting full scan`,
      });
      await cursorStore.save({
        version: 1,
        accountingSchemaVersion: ACCOUNTING_SCHEMA_VERSION,
        files: {},
        updatedAt: null,
      });
      return executeSyncInternal(opts);
    }

    // Write cursor back to the correct field
    if (isOpenCode) {
      cursors.openCodeSqlite = result.cursor as CursorState["openCodeSqlite"];
    } else if (isHermes && hermesDbKey) {
      // Initialize hermesSqlite Record if needed
      if (!cursors.hermesSqlite) {
        cursors.hermesSqlite = {};
      }
      cursors.hermesSqlite[hermesDbKey] = result.cursor as HermesSqliteCursor;
    } else if (isZcode) {
      cursors.zcodeSqlite = result.cursor as CursorState["zcodeSqlite"];
    }

    // Track this DB source as "previously synced" for cursor-loss detection
    const knownDb: Record<string, true> = cursors.knownDbSources ?? {};
    knownDb[dbSourceKey] = true;
    cursors.knownDbSources = knownDb;

    allDeltas.push(...result.deltas);
    sourceCounts[key] += result.deltas.length;
    if (key === "opencode" || key === "hermes" || key === "zcode") {
      dbsScanned[key] += 1;
    }

    const dedupSkipped = result.rowCount - (result.deltas.length > 0 ? result.deltas.length : 0);
    onProgress?.({
      source: driver.source,
      phase: "parse",
      message: `Parsed ${result.deltas.length} deltas from ${result.rowCount} SQLite rows${dedupSkipped > 0 ? ` (${dedupSkipped} deduped)` : ""}`,
    });
  }

  // Persist context state
  cursors.dirMtimes = ctx.dirMtimes;

  // Cursor-valid set for this run: paths discovery surfaced that ALSO
  // produced (or already had) a valid cursor — i.e. neither stat-failed
  // nor parse-threw. This is the set whose inodes are safe to seed the
  // alias-detection liveInodes with and whose entries are safe to record
  // in knownFilePaths.
  const cursorValidPaths = new Set<string>();
  for (const fp of discoveredFiles) {
    if (!parseFailedPaths.has(fp)) cursorValidPaths.add(fp);
  }

  // Merge into knownFilePaths only the paths that actually produced a
  // cursor this run. Recording every *discovered* path would leak a
  // known-only entry every time a parser throws after stat — sync.ts's
  // cursor-loss detection (`!cursor && knownFilePaths[path]`) would
  // then trigger a spurious full rescan the next time that path
  // reappears in discovery.
  const knownMerged: Record<string, true> = { ...(cursors.knownFilePaths ?? {}) };
  for (const fp of cursorValidPaths) knownMerged[fp] = true;
  cursors.knownFilePaths = knownMerged;

  // Alias + missing prune. See pruneAliasCursors() for the full keep/drop
  // rule and the rationale for each branch. Short version:
  //   - alias removal collapses pre-#154 Multica codex-home/sessions
  //     symlink paths to their canonical equivalents.
  //   - missing removal stops cursors.json from growing unboundedly with
  //     entries for rotated/deleted files (the PR #152 bloat case).
  //   - both leave OpenCode mtime-skipped cursors and inode-replacement
  //     replay detection alone.
  //
  // The prune pass needs to know two related-but-different things:
  //   1. Which paths' inodes should seed the liveInodes set for alias
  //      detection — only cursorValidPaths, so a parse-failed path's
  //      inode doesn't accidentally evict its own cursor as a "self alias".
  //   2. Which paths the parse loop already touched and must NOT be
  //      misclassified as alias/missing — the wider `discoveredFiles`,
  //      so a mid-flight cursor whose parse threw is kept untouched.
  //
  // OpenCode-specific: `ctx.mtimeSkippedDirs` lists session directories
  // the OpenCode driver intentionally did not enter this run because
  // their mtime was unchanged. Their per-message cursors are still
  // valid; we protect them so the prune pass doesn't stat() every
  // single message file (heavy installs have 66K+ message files).
  const pruned = await pruneAliasCursors(
    cursors.files,
    cursorValidPaths,
    cursors.knownFilePaths,
    {
      protectedPrefixes: ctx.mtimeSkippedDirs,
      inDiscoveryPaths: discoveredFiles,
    },
  );
  cursors.files = pruned.cursorFiles;
  cursors.knownFilePaths = pruned.knownFilePaths ?? cursors.knownFilePaths;

  // Persist Codex scope state. Keyed by scope, so it survives the prune above
  // dropping whichever rollout happened to observe an edge first. Scopes no
  // longer referenced by any surviving cursor are dropped so the file cannot
  // grow without bound.
  const liveScopes = new Set(
    Object.values(cursors.files).flatMap((cursor) => {
      const scopeId = (cursor as { scopeId?: string | null }).scopeId;
      return scopeId ? [scopeId] : [];
    }),
  );
  if (liveScopes.size > 0) {
    const codexScopes: Record<string, CodexScopeState> = {};
    for (const scopeId of liveScopes) {
      codexScopes[scopeId] = {
        totals: ctx.codexScopeTotals?.get(scopeId) ?? null,
        usageKeys: [...(ctx.codexSeenUsageKeys?.get(scopeId) ?? [])],
      };
    }
    cursors.codexScopes = codexScopes;
  } else {
    cursors.codexScopes = undefined;
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

  // Accounting-schema migrations overwrite buckets that still exist, but a
  // bucket the corrected scan no longer produces needs an explicit zero-value
  // tombstone — the ingest worker upserts with overwrite semantics, so a key
  // that is simply absent keeps its stale (inflated) server row forever.
  //
  // Deliberately narrow, because "absent from this scan" is NOT the same claim
  // as "this history is wrong":
  //
  //   - Only `codex` rows. v2 corrects Codex's Goal-counter accounting and
  //     nothing else; zeroing Claude/Gemini/Copilot rows whose raw logs the
  //     user has since rotated away would destroy correct, already-uploaded
  //     history.
  //   - Only when Codex was fully rescanned this run: discovery walked every
  //     directory under its roots, found at least one rollout, and every
  //     discovered rollout parsed. A missing $CODEX_HOME, an unmounted volume,
  //     an unreadable day directory, or a mid-scan read error all present as
  //     "fewer buckets produced", which must never be read as "delete the
  //     history". Directory-walk errors are swallowed by design so one bad
  //     subtree cannot fail a sync, hence the explicit completeness flag.
  //
  // Residual, accepted: a Codex hour whose rollouts were pruned before the
  // migration is zeroed rather than left at its v1 value. That value is known
  // to be inflated (v1 re-counted each file's whole cumulative total), so zero
  // is the closer of the two available answers.
  const codexFullyRescanned =
    codexFilesDiscovered > 0 &&
    codexParseFailures === 0 &&
    ctx.codexDiscoveryComplete === true;
  if (initialCursorEmpty && opts.reconcilePreviousQueueRecords && codexFullyRescanned) {
    const recordKey = (record: QueueRecord) =>
      `${record.source}|${record.model}|${record.hour_start}|${record.device_id}`;
    const currentKeys = new Set(records.map(recordKey));

    for (const previous of opts.reconcilePreviousQueueRecords) {
      if (previous.source !== "codex") continue;
      if (previous.device_id !== opts.deviceId) continue;
      const key = recordKey(previous);
      if (currentKeys.has(key)) continue;

      records.push({
        ...previous,
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
      });
      currentKeys.add(key);
    }
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
  cursors.accountingSchemaVersion = ACCOUNTING_SCHEMA_VERSION;
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
    dbsScanned,
  };
}

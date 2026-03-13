/**
 * Session sync orchestrator.
 *
 * Discovers AI tool session files, full-scans changed files (mtime+size
 * dual-check), collects SessionSnapshots, converts to SessionQueueRecords,
 * deduplicates, and writes to session queue.
 *
 * Uses the two-phase driver architecture:
 *   Phase 1: File-based drivers (generic discover → stat → skip → parse → cursor loop)
 *   Phase 2: DB-based drivers (single run() call)
 *
 * Fully independent from the token sync pipeline — separate cursors,
 * separate queue, separate files.
 */

import { stat } from "node:fs/promises";
import type {
  SessionSnapshot,
  SessionQueueRecord,
  SessionFileCursor,
  OpenCodeSqliteSessionCursor,
  Source,
} from "@pew/core";
import { SessionCursorStore } from "../storage/session-cursor-store.js";
import { SessionQueue } from "../storage/session-queue.js";
import { deduplicateSessionRecords } from "./session-upload.js";
import { createSessionDrivers } from "../drivers/registry.js";
import { hashProjectRef } from "../utils/hash-project-ref.js";
import type { FileFingerprint } from "../drivers/types.js";
import type { SessionRow, SessionMessageRow } from "../parsers/opencode-sqlite-session.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Session sync execution options */
export interface SessionSyncOptions {
  /** Directory for persisting state (cursors, queue) */
  stateDir: string;
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
  /** Factory for opening the OpenCode SQLite DB for sessions (DI for testability) */
  openSessionDb?: (dbPath: string) => {
    querySessions: (lastTimeUpdated: number) => SessionRow[];
    querySessionMessages: (sessionIds: string[]) => SessionMessageRow[];
    close: () => void;
  } | null;
  /** Override: OpenClaw data directory (~/.openclaw) */
  openclawDir?: string;
  /** Progress callback */
  onProgress?: (event: SessionProgressEvent) => void;
}

/** Progress event for UI display */
export interface SessionProgressEvent {
  source: string;
  phase: "discover" | "parse" | "dedup" | "done" | "warn";
  current?: number;
  total?: number;
  message?: string;
}

/** Result of a session sync execution */
export interface SessionSyncResult {
  totalSnapshots: number;
  totalRecords: number;
  sources: {
    claude: number;
    codex: number;
    gemini: number;
    opencode: number;
    openclaw: number;
    vscodeCopilot: number;
  };
  /** Total files/directories scanned per source */
  filesScanned: {
    claude: number;
    codex: number;
    gemini: number;
    opencode: number;
    openclaw: number;
    vscodeCopilot: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert camelCase SessionSnapshot to snake_case SessionQueueRecord.
 *
 * Defense-in-depth: validates that project_ref is either null or a
 * hex hash string. If a parser accidentally passes a non-hash value,
 * it gets hashed here as a safety net before any data leaves the device.
 */
function toQueueRecord(snap: SessionSnapshot): SessionQueueRecord {
  // Validate project_ref: must be null or a 16-char hex string (from hashProjectRef).
  // If it's something else, a parser forgot to hash — apply hashProjectRef as safety net.
  let projectRef = snap.projectRef;
  if (projectRef !== null && !/^[a-f0-9]{16}$/.test(projectRef)) {
    projectRef = hashProjectRef(projectRef);
  }

  return {
    session_key: snap.sessionKey,
    source: snap.source,
    kind: snap.kind,
    started_at: snap.startedAt,
    last_message_at: snap.lastMessageAt,
    duration_seconds: snap.durationSeconds,
    user_messages: snap.userMessages,
    assistant_messages: snap.assistantMessages,
    total_messages: snap.totalMessages,
    project_ref: projectRef,
    model: snap.model,
    snapshot_at: snap.snapshotAt,
  };
}

/** Map Source type to short result key */
function sourceKey(source: Source): keyof SessionSyncResult["sources"] {
  switch (source) {
    case "claude-code": return "claude";
    case "gemini-cli": return "gemini";
    case "opencode": return "opencode";
    case "openclaw": return "openclaw";
    case "codex": return "codex";
    case "vscode-copilot": return "vscodeCopilot";
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Execute session sync: discover files, full-scan changed files,
 * collect snapshots, deduplicate, and write to session queue.
 */
export async function executeSessionSync(
  opts: SessionSyncOptions,
): Promise<SessionSyncResult> {
  const { stateDir, onProgress } = opts;

  const cursorStore = new SessionCursorStore(stateDir);
  const queue = new SessionQueue(stateDir);
  const cursors = await cursorStore.load();

  const allSnapshots: SessionSnapshot[] = [];
  const sourceCounts = { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 };
  const filesScanned = { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0, vscodeCopilot: 0 };

  // Build driver sets from options
  const { fileDrivers, dbDrivers } = createSessionDrivers(opts);

  // Discovery options bag
  const discoverOpts = {
    claudeDir: opts.claudeDir,
    codexSessionsDir: opts.codexSessionsDir,
    geminiDir: opts.geminiDir,
    openCodeMessageDir: opts.openCodeMessageDir,
    openCodeDbPath: opts.openCodeDbPath,
    openclawDir: opts.openclawDir,
  };

  // ---------- Phase 1: File-based drivers (generic loop) ----------
  for (const driver of fileDrivers) {
    const key = sourceKey(driver.source);

    onProgress?.({
      source: driver.source,
      phase: "discover",
      message: `Discovering ${driver.source} session files...`,
    });

    const files = await driver.discover(discoverOpts);
    filesScanned[key] += files.length;

    onProgress?.({
      source: driver.source,
      phase: "parse",
      total: files.length,
      message: `Scanning ${files.length} ${driver.source} session files...`,
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

      const cursor = cursors.files[filePath] as SessionFileCursor | undefined;

      // Fast skip: file/dir unchanged since last cursor?
      if (driver.shouldSkip(cursor, fingerprint)) {
        onProgress?.({
          source: driver.source,
          phase: "parse",
          current: i + 1,
          total: files.length,
        });
        continue;
      }

      // Full-scan parse
      const snapshots = await driver.parse(filePath).catch(
        (err: unknown) => {
          onProgress?.({
            source: driver.source,
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return [] as SessionSnapshot[];
        },
      );

      // Build and persist cursor (cast narrows the registry's
      // SessionFileCursor | unknown union back to SessionFileCursor)
      cursors.files[filePath] = driver.buildCursor(fingerprint) as SessionFileCursor;

      allSnapshots.push(...snapshots);
      sourceCounts[key] += snapshots.length;

      onProgress?.({
        source: driver.source,
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }
  }

  // ---------- Phase 2: DB-based drivers ----------
  // SQLite warning paths are handled at the orchestrator level:
  // - "SQLite not available": registry doesn't create a driver (no openSessionDb)
  // - "Failed to open": factory returns null, pre-probed here to emit warning
  let activeDbDrivers = dbDrivers;
  if (opts.openCodeDbPath) {
    const dbStat = await stat(opts.openCodeDbPath).catch(() => null);
    if (dbStat) {
      if (!opts.openSessionDb) {
        // Case 1: DB file exists but SQLite adapter is missing (native module not available)
        onProgress?.({
          source: "opencode-sqlite",
          phase: "discover",
          message: "Checking OpenCode SQLite database for sessions...",
        });
        onProgress?.({
          source: "opencode-sqlite",
          phase: "warn",
          message: `OpenCode SQLite database found at ${opts.openCodeDbPath} but SQLite is not available — SQLite session data will NOT be synced`,
        });
      } else {
        // Case 2: Both provided — pre-probe if factory returns null
        const handle = opts.openSessionDb(opts.openCodeDbPath);
        if (!handle) {
          onProgress?.({
            source: "opencode-sqlite",
            phase: "discover",
            message: "Checking OpenCode SQLite database for sessions...",
          });
          onProgress?.({
            source: "opencode-sqlite",
            phase: "warn",
            message: `Failed to open OpenCode SQLite database at ${opts.openCodeDbPath} — SQLite session data will NOT be synced`,
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
      message: "Checking OpenCode SQLite database for sessions...",
    });

    // Count DB as 1 file scanned for the source
    filesScanned[key] += 1;

    const prevCursor = cursors.openCodeSqlite as OpenCodeSqliteSessionCursor | undefined;
    const result = await driver.run(prevCursor, {});

    cursors.openCodeSqlite = result.cursor as OpenCodeSqliteSessionCursor;

    allSnapshots.push(...result.snapshots);
    sourceCounts[key] += result.snapshots.length;

    onProgress?.({
      source: "opencode-sqlite",
      phase: "parse",
      message: result.snapshots.length > 0
        ? `Collected ${result.snapshots.length} sessions from ${result.rowCount} SQLite session rows`
        : "No new SQLite sessions found",
    });
  }

  // ---------- Convert snapshots to queue records ----------
  const records = allSnapshots.map(toQueueRecord);

  // ---------- Deduplicate: keep latest snapshot per session_key ----------
  onProgress?.({
    source: "all",
    phase: "dedup",
    message: `Deduplicating ${records.length} session records...`,
  });
  const deduped = deduplicateSessionRecords(records);

  // ---------- Save cursor state FIRST (before queue) ----------
  // IMPORTANT: This is the OPPOSITE order from token sync (sync.ts), and
  // intentionally so.  Token sync uses queue.overwrite() (idempotent), so
  // "queue-then-cursor" is safe — a crash just replays an overwrite.
  // Session sync uses queue.appendBatch(), so "queue-then-cursor" would
  // re-append duplicates on crash.  "Cursor-then-queue" means a crash
  // between the two loses the batch (not yet queued), but source files
  // are immutable so `pew reset` can always rebuild from scratch.
  cursors.updatedAt = new Date().toISOString();
  await cursorStore.save(cursors);

  // ---------- Write to session queue ----------
  if (deduped.length > 0) {
    await queue.appendBatch(deduped);
  }

  onProgress?.({
    source: "all",
    phase: "done",
    message: `Synced ${allSnapshots.length} snapshots → ${deduped.length} records`,
  });

  return {
    totalSnapshots: allSnapshots.length,
    totalRecords: deduped.length,
    sources: sourceCounts,
    filesScanned,
  };
}

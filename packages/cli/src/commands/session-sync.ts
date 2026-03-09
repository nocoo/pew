/**
 * Session sync orchestrator.
 *
 * Discovers AI tool session files, full-scans changed files (mtime+size
 * dual-check), collects SessionSnapshots, converts to SessionQueueRecords,
 * deduplicates, and writes to session queue.
 *
 * Fully independent from the token sync pipeline — separate cursors,
 * separate queue, separate files.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionSnapshot, SessionQueueRecord, SessionFileCursor, OpenCodeSqliteSessionCursor } from "@pew/core";
import { SessionCursorStore } from "../storage/session-cursor-store.js";
import { SessionQueue } from "../storage/session-queue.js";
import {
  discoverClaudeFiles,
  discoverCodexFiles,
  discoverGeminiFiles,
  discoverOpenClawFiles,
} from "../discovery/sources.js";
import { collectClaudeSessions } from "../parsers/claude-session.js";
import { collectCodexSessions } from "../parsers/codex-session.js";
import { collectGeminiSessions } from "../parsers/gemini-session.js";
import { collectOpenCodeSessions } from "../parsers/opencode-session.js";
import { collectOpenClawSessions } from "../parsers/openclaw-session.js";
import { collectOpenCodeSqliteSessions } from "../parsers/opencode-sqlite-session.js";
import type { SessionRow, SessionMessageRow } from "../parsers/opencode-sqlite-session.js";
import { deduplicateSessionRecords } from "./session-upload.js";

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
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert camelCase SessionSnapshot to snake_case SessionQueueRecord */
function toQueueRecord(snap: SessionSnapshot): SessionQueueRecord {
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
    project_ref: snap.projectRef,
    model: snap.model,
    snapshot_at: snap.snapshotAt,
  };
}

/**
 * Check if a file has changed since the last cursor.
 * Returns true if the file should be re-scanned (full-scan).
 */
function fileChanged(
  cursor: SessionFileCursor | undefined,
  mtimeMs: number,
  size: number,
): boolean {
  if (!cursor) return true;
  return cursor.mtimeMs !== mtimeMs || cursor.size !== size;
}

/**
 * Discover OpenCode session directories.
 *
 * Lists subdirectories under the message dir (e.g. ses_xxx/).
 * Returns absolute paths to session directories.
 */
async function discoverOpenCodeSessionDirs(
  messageDir: string,
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(messageDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => join(messageDir, e.name))
    .sort();
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
  const sourceCounts = { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0 };

  // ---------- Claude Code ----------
  if (opts.claudeDir) {
    onProgress?.({
      source: "claude-code",
      phase: "discover",
      message: "Discovering Claude Code session files...",
    });
    const files = await discoverClaudeFiles(opts.claudeDir);
    onProgress?.({
      source: "claude-code",
      phase: "parse",
      total: files.length,
      message: `Scanning ${files.length} Claude session files...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const cursor = cursors.files[filePath] as SessionFileCursor | undefined;
      if (!fileChanged(cursor, st.mtimeMs, st.size)) {
        onProgress?.({
          source: "claude-code",
          phase: "parse",
          current: i + 1,
          total: files.length,
        });
        continue;
      }

      const snapshots = await collectClaudeSessions(filePath).catch(
        (err: unknown) => {
          onProgress?.({
            source: "claude-code",
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return [] as SessionSnapshot[];
        },
      );

      // Update cursor with new mtime+size
      cursors.files[filePath] = { mtimeMs: st.mtimeMs, size: st.size };

      allSnapshots.push(...snapshots);
      sourceCounts.claude += snapshots.length;

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
      message: "Discovering Gemini CLI session files...",
    });
    const files = await discoverGeminiFiles(opts.geminiDir);
    onProgress?.({
      source: "gemini-cli",
      phase: "parse",
      total: files.length,
      message: `Scanning ${files.length} Gemini session files...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const cursor = cursors.files[filePath] as SessionFileCursor | undefined;
      if (!fileChanged(cursor, st.mtimeMs, st.size)) {
        onProgress?.({
          source: "gemini-cli",
          phase: "parse",
          current: i + 1,
          total: files.length,
        });
        continue;
      }

      const snapshots = await collectGeminiSessions(filePath).catch(
        (err: unknown) => {
          onProgress?.({
            source: "gemini-cli",
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return [] as SessionSnapshot[];
        },
      );

      cursors.files[filePath] = { mtimeMs: st.mtimeMs, size: st.size };

      allSnapshots.push(...snapshots);
      sourceCounts.gemini += snapshots.length;

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
      message: "Discovering OpenCode session directories...",
    });
    const dirs = await discoverOpenCodeSessionDirs(opts.openCodeMessageDir);
    onProgress?.({
      source: "opencode",
      phase: "parse",
      total: dirs.length,
      message: `Scanning ${dirs.length} OpenCode session directories...`,
    });

    for (let i = 0; i < dirs.length; i++) {
      const dirPath = dirs[i];
      const st = await stat(dirPath).catch(() => null);
      if (!st) continue;

      // For directories, use mtimeMs as proxy for content changes.
      // Size for dirs isn't reliable across filesystems, so we use
      // mtimeMs only and set size to 0 as a sentinel.
      const cursor = cursors.files[dirPath] as SessionFileCursor | undefined;
      if (cursor && cursor.mtimeMs === st.mtimeMs) {
        onProgress?.({
          source: "opencode",
          phase: "parse",
          current: i + 1,
          total: dirs.length,
        });
        continue;
      }

      const snapshots = await collectOpenCodeSessions(dirPath).catch(
        (err: unknown) => {
          onProgress?.({
            source: "opencode",
            phase: "warn",
            message: `Skipping ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return [] as SessionSnapshot[];
        },
      );

      cursors.files[dirPath] = { mtimeMs: st.mtimeMs, size: 0 };

      allSnapshots.push(...snapshots);
      sourceCounts.opencode += snapshots.length;

      onProgress?.({
        source: "opencode",
        phase: "parse",
        current: i + 1,
        total: dirs.length,
      });
    }
  }

  // ---------- OpenCode SQLite Sessions ----------
  if (opts.openCodeDbPath) {
    onProgress?.({
      source: "opencode-sqlite",
      phase: "discover",
      message: "Checking OpenCode SQLite database for sessions...",
    });

    const dbStat = await stat(opts.openCodeDbPath).catch(() => null);

    if (dbStat && !opts.openSessionDb) {
      // DB file exists but adapter is missing (bun:sqlite not available)
      onProgress?.({
        source: "opencode-sqlite",
        phase: "warn",
        message: `OpenCode SQLite database found at ${opts.openCodeDbPath} but bun:sqlite is not available — SQLite session data will NOT be synced`,
      });
    } else if (dbStat && opts.openSessionDb) {
      const dbInode = dbStat.ino;
      const prevSqlite = cursors.openCodeSqlite;

      // If inode changed (DB recreated), reset cursor
      const lastTimeUpdated =
        prevSqlite && prevSqlite.inode === dbInode
          ? prevSqlite.lastTimeUpdated
          : 0;
      const prevProcessedIds = new Set(
        prevSqlite && prevSqlite.inode === dbInode
          ? (prevSqlite.lastProcessedIds ?? [])
          : [],
      );

      const handle = opts.openSessionDb(opts.openCodeDbPath);
      if (handle) {
        try {
          // Query uses >= to avoid missing same-millisecond rows.
          // We dedup previously-processed IDs from the prior batch.
          const rawSessions = handle.querySessions(lastTimeUpdated);
          const sessions = prevProcessedIds.size > 0
            ? rawSessions.filter((s) => !prevProcessedIds.has(s.id))
            : rawSessions;

          if (sessions.length > 0) {
            const sessionIds = sessions.map((s) => s.id);
            const messages = handle.querySessionMessages(sessionIds);
            const snapshots = collectOpenCodeSqliteSessions(sessions, messages);

            onProgress?.({
              source: "opencode-sqlite",
              phase: "parse",
              message: `Collected ${snapshots.length} sessions from ${rawSessions.length} SQLite session rows`,
            });

            allSnapshots.push(...snapshots);
            sourceCounts.opencode += snapshots.length;
          } else {
            onProgress?.({
              source: "opencode-sqlite",
              phase: "parse",
              message: "No new SQLite sessions found",
            });
          }

          // Update session cursor — advance past ALL queried sessions.
          // Sessions are ORDER BY time_updated ASC, so last has the max.
          // Track IDs at the max timestamp for same-millisecond dedup
          // on the next query.
          const maxTimeUpdated = rawSessions.length > 0
            ? rawSessions[rawSessions.length - 1].time_updated
            : lastTimeUpdated;
          const idsAtMax = rawSessions
            .filter((s) => s.time_updated === maxTimeUpdated)
            .map((s) => s.id);
          cursors.openCodeSqlite = {
            lastTimeUpdated: maxTimeUpdated,
            lastProcessedIds: idsAtMax,
            inode: dbInode,
            updatedAt: new Date().toISOString(),
          } satisfies OpenCodeSqliteSessionCursor;
        } finally {
          handle.close();
        }
      } else {
        // openSessionDb returned null — DB exists but couldn't be opened
        onProgress?.({
          source: "opencode-sqlite",
          phase: "warn",
          message: `Failed to open OpenCode SQLite database at ${opts.openCodeDbPath} — SQLite session data will NOT be synced`,
        });
      }
    }
  }

  // ---------- OpenClaw ----------
  if (opts.openclawDir) {
    onProgress?.({
      source: "openclaw",
      phase: "discover",
      message: "Discovering OpenClaw session files...",
    });
    const files = await discoverOpenClawFiles(opts.openclawDir);
    onProgress?.({
      source: "openclaw",
      phase: "parse",
      total: files.length,
      message: `Scanning ${files.length} OpenClaw session files...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const cursor = cursors.files[filePath] as SessionFileCursor | undefined;
      if (!fileChanged(cursor, st.mtimeMs, st.size)) {
        onProgress?.({
          source: "openclaw",
          phase: "parse",
          current: i + 1,
          total: files.length,
        });
        continue;
      }

      const snapshots = await collectOpenClawSessions(filePath).catch(
        (err: unknown) => {
          onProgress?.({
            source: "openclaw",
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return [] as SessionSnapshot[];
        },
      );

      cursors.files[filePath] = { mtimeMs: st.mtimeMs, size: st.size };

      allSnapshots.push(...snapshots);
      sourceCounts.openclaw += snapshots.length;

      onProgress?.({
        source: "openclaw",
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }
  }

  // ---------- Codex CLI ----------
  if (opts.codexSessionsDir) {
    onProgress?.({
      source: "codex",
      phase: "discover",
      message: "Discovering Codex CLI session files...",
    });
    const files = await discoverCodexFiles(opts.codexSessionsDir);
    onProgress?.({
      source: "codex",
      phase: "parse",
      total: files.length,
      message: `Scanning ${files.length} Codex session files...`,
    });

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const st = await stat(filePath).catch(() => null);
      if (!st) continue;

      const cursor = cursors.files[filePath] as SessionFileCursor | undefined;
      if (!fileChanged(cursor, st.mtimeMs, st.size)) {
        onProgress?.({
          source: "codex",
          phase: "parse",
          current: i + 1,
          total: files.length,
        });
        continue;
      }

      const snapshots = await collectCodexSessions(filePath).catch(
        (err: unknown) => {
          onProgress?.({
            source: "codex",
            phase: "warn",
            message: `Skipping ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          });
          return [] as SessionSnapshot[];
        },
      );

      cursors.files[filePath] = { mtimeMs: st.mtimeMs, size: st.size };

      allSnapshots.push(...snapshots);
      sourceCounts.codex += snapshots.length;

      onProgress?.({
        source: "codex",
        phase: "parse",
        current: i + 1,
        total: files.length,
      });
    }
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
  // Same safety invariant as token sync: cursor saved before queue
  // so a crash never causes duplicate writes.
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
  };
}

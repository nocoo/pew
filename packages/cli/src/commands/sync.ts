import { stat } from "node:fs/promises";
import type {
  ByteOffsetCursor,
  CursorState,
  GeminiCursor,
  OpenCodeCursor,
  QueueRecord,
  Source,
  TokenDelta,
} from "@zebra/core";
import { CursorStore } from "../storage/cursor-store.js";
import { LocalQueue } from "../storage/local-queue.js";
import {
  discoverClaudeFiles,
  discoverGeminiFiles,
  discoverOpenCodeFiles,
  discoverOpenClawFiles,
} from "../discovery/sources.js";
import { parseClaudeFile } from "../parsers/claude.js";
import { parseGeminiFile } from "../parsers/gemini.js";
import { parseOpenCodeFile } from "../parsers/opencode.js";
import { parseOpenClawFile } from "../parsers/openclaw.js";
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
  /** Override: OpenClaw data directory (~/.openclaw) */
  openclawDir?: string;
  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
}

/** Progress event for UI display */
export interface ProgressEvent {
  source: string;
  phase: "discover" | "parse" | "aggregate" | "done";
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

  // ---------- Claude Code ----------
  if (opts.claudeDir) {
    onProgress?.({
      source: "claude-code",
      phase: "discover",
      message: "Discovering Claude Code files...",
    });
    const files = await discoverClaudeFiles(opts.claudeDir);
    onProgress?.({
      source: "claude-code",
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

      const result = await parseClaudeFile({ filePath, startOffset });

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
      });

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
    const files = await discoverOpenCodeFiles(opts.openCodeMessageDir);
    onProgress?.({
      source: "opencode",
      phase: "parse",
      total: files.length,
      message: `Parsing ${files.length} OpenCode files...`,
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
        continue;
      }

      const lastTotals =
        prev && prev.inode === inode ? (prev.lastTotals ?? null) : null;

      const result = await parseOpenCodeFile({ filePath, lastTotals });

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
  }

  // ---------- OpenClaw ----------
  if (opts.openclawDir) {
    onProgress?.({
      source: "openclaw",
      phase: "discover",
      message: "Discovering OpenClaw files...",
    });
    const files = await discoverOpenClawFiles(opts.openclawDir);
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

      const result = await parseOpenClawFile({ filePath, startOffset });

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

  if (records.length > 0) {
    await queue.appendBatch(records);
  }

  // ---------- Save cursor state ----------
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
  };
}

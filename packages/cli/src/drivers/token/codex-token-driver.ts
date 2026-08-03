/**
 * Codex CLI file token driver.
 *
 * Strategy: Byte-offset JSONL streaming + unique cumulative-usage edges.
 * Skip gate: fileUnchanged() (inode + mtimeMs + size).
 * Parser: last_token_usage is counted once per (Goal root, total, last) edge.
 *
 * Token accounting migrations (disjoint fields + Goal edge dedup) are handled
 * globally via CursorState.accountingSchemaVersion, with a Codex-only replay
 * safeguard for cursors that lack persisted usage-edge keys.
 */

import type { CodexCursor, TokenDelta } from "@pew/core";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { discoverCodexFiles } from "../../discovery/sources.js";
import { parseCodexFile } from "../../parsers/codex.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type {
  FileTokenDriver,
  DiscoverOpts,
  SyncContext,
  FileFingerprint,
  ResumeState,
  TokenParseResult,
  CodexResumeState,
} from "../types.js";

/** Extended parse result carrying Codex-specific cursor state */
interface CodexParseResult extends TokenParseResult {
  endOffset: number;
  lastTotals: TokenDelta | null;
  lastModel: string | null;
  scopeId: string | null;
  usageKeys: string[];
}

interface CodexScopeNode {
  filePath: string;
  threadId: string | null;
  sessionId: string | null;
  parentThreadId: string | null;
}

const ROLLOUT_THREAD_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function rolloutThreadId(filePath: string): string | null {
  return basename(filePath).match(ROLLOUT_THREAD_ID_RE)?.[1] ?? null;
}

async function readScopeNode(filePath: string): Promise<CodexScopeNode> {
  const node: CodexScopeNode = {
    filePath,
    threadId: rolloutThreadId(filePath),
    sessionId: null,
    parentThreadId: null,
  };
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type !== "session_meta") continue;
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (!payload) break;
      node.sessionId = typeof payload.id === "string" ? payload.id : null;
      const source = payload.source as Record<string, unknown> | undefined;
      const subagent = source?.subagent as Record<string, unknown> | undefined;
      const spawn = subagent?.thread_spawn as Record<string, unknown> | undefined;
      node.parentThreadId = typeof spawn?.parent_thread_id === "string"
        ? spawn.parent_thread_id
        : null;
      break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return node;
}

async function resolveCodexScopes(files: string[]): Promise<{
  fileScopes: Map<string, string>;
  scopeFileCounts: Map<string, number>;
}> {
  const nodes: CodexScopeNode[] = [];
  // Avoid opening thousands of rollout files at once on long-lived installs.
  for (let i = 0; i < files.length; i += 32) {
    nodes.push(...await Promise.all(files.slice(i, i + 32).map(readScopeNode)));
  }
  const byThread = new Map<string, CodexScopeNode>();
  for (const node of nodes) {
    if (node.threadId) byThread.set(node.threadId, node);
  }
  const memo = new Map<string, string>();
  const resolving = new Set<string>();
  function resolveNode(node: CodexScopeNode): string | null {
    const key = node.threadId ?? node.filePath;
    const known = memo.get(key);
    if (known) return known;
    if (resolving.has(key)) return node.sessionId ?? node.threadId;
    resolving.add(key);
    let scope: string | null = null;
    if (node.parentThreadId) {
      const parent = byThread.get(node.parentThreadId);
      scope = parent ? resolveNode(parent) : node.parentThreadId;
    }
    scope ??= node.sessionId ?? node.threadId;
    resolving.delete(key);
    if (scope) memo.set(key, scope);
    return scope;
  }

  const fileScopes = new Map<string, string>();
  const scopeFileCounts = new Map<string, number>();
  for (const node of nodes) {
    const scope = resolveNode(node);
    if (!scope) continue;
    fileScopes.set(node.filePath, scope);
    scopeFileCounts.set(scope, (scopeFileCounts.get(scope) ?? 0) + 1);
  }
  return { fileScopes, scopeFileCounts };
}

export const codexTokenDriver: FileTokenDriver<CodexCursor> = {
  kind: "file",
  source: "codex",

  async discover(opts: DiscoverOpts, ctx: SyncContext): Promise<string[]> {
    if (!opts.codexSessionsDir) return [];
    const files = await discoverCodexFiles(opts.codexSessionsDir, opts.multicaCodexDirs);

    // Scope resolution reads each rollout's session_meta header. That is far
    // too expensive to redo for every known file on every sync (installs carry
    // thousands of rollouts, and the notify hook syncs at every session end),
    // so paths whose cursor already recorded a scope are reused as-is and only
    // genuinely new rollouts are opened.
    const known = ctx.codexKnownScopes ?? {};
    const unresolved = files.filter((filePath) => !known[filePath]);
    const { fileScopes, scopeFileCounts } = await resolveCodexScopes(unresolved);

    for (const filePath of files) {
      const cached = known[filePath];
      if (!cached) continue;
      fileScopes.set(filePath, cached);
      scopeFileCounts.set(cached, (scopeFileCounts.get(cached) ?? 0) + 1);
    }

    ctx.codexFileScopes = fileScopes;
    ctx.codexScopeFileCounts = scopeFileCounts;
    ctx.codexScopeTotals ??= new Map<string, TokenDelta>();
    ctx.codexSeenUsageKeys ??= new Map<string, Set<string>>();
    return files;
  },

  needsReplay(cursor: CodexCursor | undefined): boolean {
    return !!cursor && !Object.hasOwn(cursor, "scopeId");
  },

  shouldSkip(cursor: CodexCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  },

  resumeState(cursor: CodexCursor | undefined, fingerprint: FileFingerprint): CodexResumeState {
    const sameFile = cursor && cursor.inode === fingerprint.inode;
    return {
      kind: "codex",
      startOffset: sameFile ? (cursor.offset ?? 0) : 0,
      lastTotals: sameFile ? (cursor.lastTotals ?? null) : null,
      lastModel: sameFile ? (cursor.lastModel ?? null) : null,
    };
  },

  async parse(filePath: string, resume: ResumeState, _ctx: SyncContext): Promise<CodexParseResult> {
    const r = resume as CodexResumeState;
    const scopeId = _ctx.codexFileScopes?.get(filePath) ?? filePath;
    const sharedScope = scopeId !== null && (_ctx.codexScopeFileCounts?.get(scopeId) ?? 0) > 1;
    const highWaterTotals = sharedScope
      ? (_ctx.codexScopeTotals?.get(scopeId) ?? null)
      : undefined;
    _ctx.codexSeenUsageKeys ??= new Map<string, Set<string>>();
    const seenUsageKeys = _ctx.codexSeenUsageKeys.get(scopeId) ?? new Set<string>();
    _ctx.codexSeenUsageKeys.set(scopeId, seenUsageKeys);
    const result = await parseCodexFile({
      filePath,
      startOffset: r.startOffset,
      lastTotals: r.lastTotals,
      lastModel: r.lastModel,
      ...(sharedScope ? { highWaterTotals } : {}),
      seenUsageKeys,
    });
    if (sharedScope && scopeId && result.highWaterTotals) {
      _ctx.codexScopeTotals ??= new Map<string, TokenDelta>();
      _ctx.codexScopeTotals.set(scopeId, result.highWaterTotals);
    }
    return {
      deltas: result.deltas,
      endOffset: result.endOffset,
      lastTotals: result.lastTotals,
      lastModel: result.lastModel,
      scopeId,
      usageKeys: result.usageKeys,
    };
  },

  buildCursor(
    fingerprint: FileFingerprint,
    result: TokenParseResult,
    _prev?: CodexCursor,
  ): CodexCursor {
    const r = result as CodexParseResult;
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: r.endOffset,
      lastTotals: r.lastTotals,
      lastModel: r.lastModel,
      scopeId: r.scopeId,
      updatedAt: new Date().toISOString(),
    };
  },
};

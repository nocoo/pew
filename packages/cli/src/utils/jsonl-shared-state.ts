import type { TokenDelta } from "@pew/core";
import type { SyncContext } from "../drivers/types.js";

export type CodexSharedSnapshot = {
  scopeId: string;
  hadTotals: boolean;
  totals: TokenDelta | undefined;
  usageKeys: string[];
} | null;

/**
 * Dedup-set rollback marker.
 *
 * The set only ever grows during a parse — nothing removes from it — so a
 * discarded parse is undone by deleting whatever was appended after the
 * marker. Recording a size instead of a copy keeps this O(1) on the happy
 * path: a cold scan holds one entry per emitted id across every file, and
 * copying all of them once per file made the copy 39% of a wide scan.
 */
export type IdsSnapshot = { existed: false } | { existed: true; size: number };

export type JsonlSharedSnapshot = {
  codex: CodexSharedSnapshot;
  claudeIds: IdsSnapshot;
  workbuddyIds: IdsSnapshot;
};

export function snapshotCodexSharedState(
  ctx: SyncContext,
  filePath: string,
): CodexSharedSnapshot {
  const scopeId = ctx.codexFileScopes?.get(filePath);
  if (!scopeId) return null;
  const hadTotals = ctx.codexScopeTotals?.has(scopeId) ?? false;
  const totals = hadTotals ? ctx.codexScopeTotals?.get(scopeId) : undefined;
  return {
    scopeId,
    hadTotals,
    totals: totals ? { ...totals } : undefined,
    usageKeys: [...(ctx.codexSeenUsageKeys?.get(scopeId) ?? [])],
  };
}

export function restoreCodexSharedState(
  ctx: SyncContext,
  snapshot: CodexSharedSnapshot,
): void {
  if (!snapshot) return;
  if (snapshot.hadTotals && snapshot.totals) {
    ctx.codexScopeTotals?.set(snapshot.scopeId, snapshot.totals);
  } else {
    ctx.codexScopeTotals?.delete(snapshot.scopeId);
  }
  const existing = ctx.codexSeenUsageKeys?.get(snapshot.scopeId);
  if (existing) {
    existing.clear();
    for (const key of snapshot.usageKeys) existing.add(key);
    return;
  }
  if (snapshot.usageKeys.length > 0) {
    ctx.codexSeenUsageKeys ??= new Map();
    ctx.codexSeenUsageKeys.set(snapshot.scopeId, new Set(snapshot.usageKeys));
  }
}

const idsSnapshot = (seen: Set<string> | undefined): IdsSnapshot =>
  seen ? { existed: true, size: seen.size } : { existed: false };

export function snapshotJsonlSharedState(
  ctx: SyncContext,
  filePath: string,
): JsonlSharedSnapshot {
  return {
    codex: snapshotCodexSharedState(ctx, filePath),
    claudeIds: idsSnapshot(ctx.seenClaudeMessageIds),
    workbuddyIds: idsSnapshot(ctx.seenWorkbuddyMessageIds),
  };
}

/**
 * Drop every id a discarded parse appended after `snapshot`. Insertion order
 * is stable and nothing deletes mid-parse, so the entries past the marker are
 * exactly this parse's additions. A set that did not exist before the parse
 * holds only discarded ids, so it is cleared outright — which also covers the
 * case where the parse itself created the set.
 */
function dropIdsAppendedAfter(seen: Set<string>, snapshot: IdsSnapshot): void {
  if (!snapshot.existed) {
    seen.clear();
    return;
  }
  const appended: string[] = [];
  let index = 0;
  for (const id of seen) {
    if (index >= snapshot.size) appended.push(id);
    index += 1;
  }
  for (const id of appended) seen.delete(id);
}

export function restoreJsonlSharedState(
  ctx: SyncContext,
  snapshot: JsonlSharedSnapshot,
): void {
  restoreCodexSharedState(ctx, snapshot.codex);
  const workbuddy = ctx.seenWorkbuddyMessageIds;
  if (workbuddy) dropIdsAppendedAfter(workbuddy, snapshot.workbuddyIds);
  const seen = ctx.seenClaudeMessageIds;
  if (seen) dropIdsAppendedAfter(seen, snapshot.claudeIds);
}

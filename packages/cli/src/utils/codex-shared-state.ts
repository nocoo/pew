import type { TokenDelta } from "@pew/core";
import type { SyncContext } from "../drivers/types.js";

export type CodexSharedSnapshot = {
  scopeId: string;
  hadTotals: boolean;
  totals: TokenDelta | undefined;
  usageKeys: string[];
} | null;

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

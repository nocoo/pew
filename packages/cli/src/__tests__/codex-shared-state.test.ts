import { describe, expect, it } from "vitest";
import type { TokenDelta } from "@pew/core";
import type { SyncContext } from "../drivers/types.js";
import {
  restoreCodexSharedState,
  restoreJsonlSharedState,
  snapshotCodexSharedState,
  snapshotJsonlSharedState,
} from "../utils/jsonl-shared-state.js";

const totals = (input: number): TokenDelta => ({
  inputTokens: input,
  cachedInputTokens: 0,
  outputTokens: 1,
  reasoningOutputTokens: 0,
});

describe("snapshotCodexSharedState / restoreCodexSharedState", () => {
  it("is a no-op when the file has no Codex scope", () => {
    const ctx: SyncContext = {
      codexSeenUsageKeys: new Map([["scope", new Set(["a"])]]),
    };
    const snapshot = snapshotCodexSharedState(ctx, "/missing.jsonl");
    expect(snapshot).toBeNull();
    restoreCodexSharedState(ctx, snapshot);
    expect([...ctx.codexSeenUsageKeys.get("scope")!]).toEqual(["a"]);
  });

  it("rolls back usage keys and totals mutated during a discarded parse", () => {
    const scopeId = "goal-1";
    const filePath = "/rollout.jsonl";
    const seen = new Set(["edge-a"]);
    const ctx: SyncContext = {
      codexFileScopes: new Map([[filePath, scopeId]]),
      codexScopeTotals: new Map([[scopeId, totals(10)]]),
      codexSeenUsageKeys: new Map([[scopeId, seen]]),
    };
    const snapshot = snapshotCodexSharedState(ctx, filePath);
    seen.add("edge-b");
    ctx.codexScopeTotals!.set(scopeId, totals(99));
    restoreCodexSharedState(ctx, snapshot);
    expect([...ctx.codexSeenUsageKeys!.get(scopeId)!]).toEqual(["edge-a"]);
    expect(ctx.codexScopeTotals!.get(scopeId)).toEqual(totals(10));
  });

  it("recreates a missing usage-key set from the snapshot", () => {
    const scopeId = "goal-3";
    const filePath = "/missing-set.jsonl";
    const ctx: SyncContext = {
      codexFileScopes: new Map([[filePath, scopeId]]),
      codexSeenUsageKeys: new Map([[scopeId, new Set(["edge-a"])]]),
    };
    const snapshot = snapshotCodexSharedState(ctx, filePath);
    ctx.codexSeenUsageKeys!.delete(scopeId);
    restoreCodexSharedState(ctx, snapshot);
    expect([...ctx.codexSeenUsageKeys!.get(scopeId)!]).toEqual(["edge-a"]);
  });

  it("removes totals that were absent before parse", () => {
    const scopeId = "goal-2";
    const filePath = "/child.jsonl";
    const ctx: SyncContext = {
      codexFileScopes: new Map([[filePath, scopeId]]),
      codexScopeTotals: new Map(),
      codexSeenUsageKeys: new Map([[scopeId, new Set<string>()]]),
    };
    const snapshot = snapshotCodexSharedState(ctx, filePath);
    ctx.codexScopeTotals!.set(scopeId, totals(5));
    ctx.codexSeenUsageKeys!.get(scopeId)!.add("edge-new");
    restoreCodexSharedState(ctx, snapshot);
    expect(ctx.codexScopeTotals!.has(scopeId)).toBe(false);
    expect([...ctx.codexSeenUsageKeys!.get(scopeId)!]).toEqual([]);
  });
});

describe("snapshotJsonlSharedState / restoreJsonlSharedState", () => {
  it("rolls back Claude message ids mutated during a discarded parse", () => {
    const ctx: SyncContext = {
      seenClaudeMessageIds: new Set(["keep"]),
    };
    const snapshot = snapshotJsonlSharedState(ctx, "/unused.jsonl");
    ctx.seenClaudeMessageIds!.add("from-discarded-file");
    restoreJsonlSharedState(ctx, snapshot);
    expect([...ctx.seenClaudeMessageIds!]).toEqual(["keep"]);
  });

  it("clears a Claude set that did not exist before parse", () => {
    const ctx: SyncContext = {};
    const snapshot = snapshotJsonlSharedState(ctx, "/unused.jsonl");
    ctx.seenClaudeMessageIds = new Set(["new"]);
    restoreJsonlSharedState(ctx, snapshot);
    expect([...(ctx.seenClaudeMessageIds ?? [])]).toEqual([]);
  });
});

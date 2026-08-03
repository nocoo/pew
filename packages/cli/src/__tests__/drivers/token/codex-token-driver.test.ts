import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexTokenDriver } from "../../../drivers/token/codex-token-driver.js";
import type { CodexCursor } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Codex JSONL token_count event line */
function codexTokenLine(opts: {
  input?: number;
  output?: number;
  lastInput?: number;
  lastOutput?: number;
  model?: string;
  timestamp?: string;
} = {}): string {
  const {
    input = 1000,
    output = 200,
    lastInput,
    lastOutput,
    timestamp = "2026-03-07T10:15:30.000Z",
  } = opts;
  return JSON.stringify({
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          output_tokens: output,
          input_tokens_cache_hit: 0,
          reasoning_tokens: 50,
        },
        ...(lastInput !== undefined || lastOutput !== undefined
          ? {
              last_token_usage: {
                input_tokens: lastInput ?? 0,
                cached_input_tokens: 0,
                output_tokens: lastOutput ?? 0,
                reasoning_output_tokens: 0,
              },
            }
          : {}),
      },
    },
  });
}

/** Helper: create a Codex session_meta line with model */
function codexSessionMeta(model = "o3-mini"): string {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-03-07T10:00:00.000Z",
    payload: { model },
  });
}

function codexGoalSessionMeta(opts: {
  id: string;
  parentThreadId?: string;
}): string {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-03-07T10:00:00.000Z",
    payload: {
      id: opts.id,
      model: "gpt-5.4",
      source: opts.parentThreadId
        ? {
            subagent: {
              thread_spawn: { parent_thread_id: opts.parentThreadId },
            },
          }
        : "vscode",
    },
  });
}

describe("codexTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-codex-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(codexTokenDriver.kind).toBe("file");
    expect(codexTokenDriver.source).toBe("codex");
  });

  describe("discover", () => {
    it("returns [] when codexSessionsDir is not set", async () => {
      const files = await codexTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers JSONL rollout files under codexSessionsDir", async () => {
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      await writeFile(
        join(dayDir, "rollout-abc123.jsonl"),
        `${codexSessionMeta()}\n${codexTokenLine()}\n`,
      );

      const files = await codexTokenDriver.discover(
        { codexSessionsDir: tempDir },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("rollout-abc123.jsonl");
    });

    it("discovers files from both codexSessionsDir and multicaCodexDirs", async () => {
      // Primary dir
      const primaryDir = join(tempDir, "primary", "2026", "03", "07");
      await mkdir(primaryDir, { recursive: true });
      await writeFile(
        join(primaryDir, "rollout-primary.jsonl"),
        `${codexSessionMeta()}\n${codexTokenLine()}\n`,
      );

      // Multica extra dirs
      const multicaDir1 = join(tempDir, "multica", "ws1", "task1", "sessions");
      const multicaDir2 = join(tempDir, "multica", "ws2", "task2", "sessions");
      await mkdir(multicaDir1, { recursive: true });
      await mkdir(multicaDir2, { recursive: true });
      await writeFile(
        join(multicaDir1, "rollout-multica1.jsonl"),
        `${codexSessionMeta()}\n${codexTokenLine()}\n`,
      );
      await writeFile(
        join(multicaDir2, "rollout-multica2.jsonl"),
        `${codexSessionMeta()}\n${codexTokenLine()}\n`,
      );

      const files = await codexTokenDriver.discover(
        {
          codexSessionsDir: join(tempDir, "primary"),
          multicaCodexDirs: [multicaDir1, multicaDir2],
        },
        ctx,
      );
      expect(files).toHaveLength(3);
      expect(files.some((f) => f.includes("rollout-primary.jsonl"))).toBe(true);
      expect(files.some((f) => f.includes("rollout-multica1.jsonl"))).toBe(true);
      expect(files.some((f) => f.includes("rollout-multica2.jsonl"))).toBe(true);
    });

    it("works with empty multicaCodexDirs array", async () => {
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      await writeFile(
        join(dayDir, "rollout-abc123.jsonl"),
        `${codexSessionMeta()}\n${codexTokenLine()}\n`,
      );

      const files = await codexTokenDriver.discover(
        { codexSessionsDir: tempDir, multicaCodexDirs: [] },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("rollout-abc123.jsonl");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 500,
      mtimeMs: 1709827200000,
      size: 2048,
    };

    it("returns false when cursor is undefined", () => {
      expect(codexTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: CodexCursor = {
        inode: 500,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 300,
        lastTotals: null,
        lastModel: null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(codexTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 500,
      mtimeMs: 1709827200000,
      size: 2048,
    };

    it("returns default state when no cursor", () => {
      const state = codexTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      });
    });

    it("returns stored state when inode matches", () => {
      const lastTotals = {
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 200,
        reasoningOutputTokens: 50,
      };
      const cursor: CodexCursor = {
        inode: 500,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 300,
        lastTotals,
        lastModel: "o3-mini",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = codexTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 300,
        lastTotals,
        lastModel: "o3-mini",
      });
    });

    it("defaults undefined fields to null/0 when inode matches (old cursor)", () => {
      const cursor: CodexCursor = {
        inode: 500,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: undefined as unknown as number,
        lastTotals: undefined as unknown as null,
        lastModel: undefined as unknown as null,
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = codexTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      });
    });

    it("resets state when inode differs", () => {
      const cursor: CodexCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 300,
        lastTotals: null,
        lastModel: "o3-mini",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = codexTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({
        kind: "codex",
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses Codex JSONL and builds cursor with endOffset + lastTotals", async () => {
      const filePath = join(tempDir, "rollout-abc.jsonl");
      const content =
        `${codexSessionMeta("o3-mini")}\n${codexTokenLine({ input: 1000, output: 200 })}\n`;
      await writeFile(filePath, content);

      const resume = {
        kind: "codex" as const,
        startOffset: 0,
        lastTotals: null,
        lastModel: null,
      };
      const result = await codexTokenDriver.parse(filePath, resume, ctx);

      // Codex uses cumulative diff — first absolute totals produce a delta
      expect(result.deltas.length).toBeGreaterThanOrEqual(1);
      if (result.deltas.length > 0) {
        expect(result.deltas[0].source).toBe("codex");
      }

      const fingerprint: FileFingerprint = {
        inode: 500,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = codexTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(500);
      expect(cursor.offset).toBeGreaterThan(0);
      expect(cursor.updatedAt).toBeDefined();
      expect(cursor).toHaveProperty("scopeId");
    });

    it("counts a shared Goal counter once across continuation rollout files", async () => {
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      const goalId = "019f9edc-bc7f-7ef1-8d32-35f66809b013";
      const rootPath = join(
        dayDir,
        `rollout-2026-03-07T10-00-00-${goalId}.jsonl`,
      );
      const continuationPath = join(
        dayDir,
        "rollout-2026-03-07T11-00-00-019fbeda-8b7d-7b13-9eb3-87cecc4607e9.jsonl",
      );
      await writeFile(
        rootPath,
        `${[
          codexGoalSessionMeta({ id: goalId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10, timestamp: "2026-03-07T10:01:00.000Z" }),
          codexTokenLine({ input: 200, output: 20, lastInput: 100, lastOutput: 10, timestamp: "2026-03-07T10:02:00.000Z" }),
        ].join("\n")}\n`,
      );
      // Goal continuation rollouts replay the same process-wide cumulative
      // counter from the beginning, often with different event timestamps.
      await writeFile(
        continuationPath,
        `${[
          codexGoalSessionMeta({ id: goalId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10, timestamp: "2026-03-07T11:01:00.000Z" }),
          codexTokenLine({ input: 200, output: 20, lastInput: 100, lastOutput: 10, timestamp: "2026-03-07T11:02:00.000Z" }),
          codexTokenLine({ input: 300, output: 30, lastInput: 100, lastOutput: 10, timestamp: "2026-03-07T11:03:00.000Z" }),
        ].join("\n")}\n`,
      );

      const goalCtx: SyncContext = {};
      const files = await codexTokenDriver.discover(
        { codexSessionsDir: tempDir },
        goalCtx,
      );
      codexTokenDriver.preload?.({}, goalCtx);
      const deltas = [];
      for (const filePath of files) {
        const st = await import("node:fs/promises").then((m) => m.stat(filePath));
        const fingerprint: FileFingerprint = {
          inode: Number(st.ino),
          mtimeMs: st.mtimeMs,
          size: st.size,
        };
        const result = await codexTokenDriver.parse(
          filePath,
          codexTokenDriver.resumeState(undefined, fingerprint),
          goalCtx,
        );
        deltas.push(...result.deltas);
        const cursor = codexTokenDriver.buildCursor(fingerprint, result);
        expect((cursor as CodexCursor & { scopeId?: string }).scopeId).toBe(goalId);
      }

      expect(deltas.reduce((sum, d) => sum + d.tokens.inputTokens, 0)).toBe(300);
      expect(deltas.reduce((sum, d) => sum + d.tokens.outputTokens, 0)).toBe(30);
    });

    it("keeps scope dedup state after the rollout that claimed an edge is pruned", async () => {
      // Regression: usage edges used to be stored on the cursor of whichever
      // rollout observed them first. Pruning that rollout dropped the keys, so
      // the next Goal continuation replayed the same history and counted it
      // twice. Scope state now lives in CursorState.codexScopes and survives.
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      const goalId = "019f9edc-bc7f-7ef1-8d32-35f66809b013";
      const rootPath = join(dayDir, `rollout-2026-03-07T10-00-00-${goalId}.jsonl`);
      const continuationPath = join(
        dayDir,
        "rollout-2026-03-07T11-00-00-019fbeda-8b7d-7b13-9eb3-87cecc4607e9.jsonl",
      );
      await writeFile(
        rootPath,
        `${[
          codexGoalSessionMeta({ id: goalId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10 }),
        ].join("\n")}\n`,
      );

      const firstCtx: SyncContext = {};
      await codexTokenDriver.discover({ codexSessionsDir: tempDir }, firstCtx);
      const rootStat = await stat(rootPath);
      const rootFingerprint: FileFingerprint = {
        inode: Number(rootStat.ino),
        mtimeMs: rootStat.mtimeMs,
        size: rootStat.size,
      };
      const rootResult = await codexTokenDriver.parse(
        rootPath,
        codexTokenDriver.resumeState(undefined, rootFingerprint),
        firstCtx,
      );
      const rootCursor = codexTokenDriver.buildCursor(rootFingerprint, rootResult);
      expect(rootCursor.scopeId).toBe(goalId);

      // What the orchestrator persists to CursorState.codexScopes.
      const persistedKeys = [...(firstCtx.codexSeenUsageKeys?.get(goalId) ?? [])];
      expect(persistedKeys).toHaveLength(1);

      // The rollout that claimed the edge is pruned; only the continuation,
      // which replays the same cumulative history, remains.
      await rm(rootPath);
      await writeFile(
        continuationPath,
        `${[
          codexGoalSessionMeta({ id: goalId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10 }),
          codexTokenLine({ input: 200, output: 20, lastInput: 100, lastOutput: 10 }),
        ].join("\n")}\n`,
      );

      const secondCtx: SyncContext = {
        codexSeenUsageKeys: new Map([[goalId, new Set(persistedKeys)]]),
      };
      await codexTokenDriver.discover({ codexSessionsDir: tempDir }, secondCtx);
      const continuationStat = await stat(continuationPath);
      const continuationFingerprint: FileFingerprint = {
        inode: Number(continuationStat.ino),
        mtimeMs: continuationStat.mtimeMs,
        size: continuationStat.size,
      };
      const continuationResult = await codexTokenDriver.parse(
        continuationPath,
        codexTokenDriver.resumeState(undefined, continuationFingerprint),
        secondCtx,
      );

      // Only the genuinely new edge, not the replayed one.
      expect(continuationResult.deltas).toHaveLength(1);
      expect(continuationResult.deltas[0].tokens.inputTokens).toBe(100);
    });

    it("resolves subagent counters to the parent Goal scope", async () => {
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      const goalId = "019f9edc-bc7f-7ef1-8d32-35f66809b013";
      const parentThreadId = "019fbeda-8b7d-7b13-9eb3-87cecc4607e9";
      const childThreadId = "019fbf71-32f5-70d3-9113-2f8b4430656e";
      const parentPath = join(
        dayDir,
        `rollout-2026-03-07T10-00-00-${parentThreadId}.jsonl`,
      );
      const childPath = join(
        dayDir,
        `rollout-2026-03-07T10-30-00-${childThreadId}.jsonl`,
      );
      await writeFile(
        parentPath,
        `${[
          codexGoalSessionMeta({ id: goalId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10 }),
          codexTokenLine({ input: 200, output: 20, lastInput: 100, lastOutput: 10 }),
        ].join("\n")}\n`,
      );
      await writeFile(
        childPath,
        `${[
          codexGoalSessionMeta({ id: childThreadId, parentThreadId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10 }),
          codexTokenLine({ input: 200, output: 20, lastInput: 100, lastOutput: 10 }),
          codexTokenLine({ input: 250, output: 25, lastInput: 50, lastOutput: 5 }),
        ].join("\n")}\n`,
      );

      const goalCtx: SyncContext = {};
      const files = await codexTokenDriver.discover(
        { codexSessionsDir: tempDir },
        goalCtx,
      );
      const deltas = [];
      for (const filePath of files) {
        const st = await import("node:fs/promises").then((m) => m.stat(filePath));
        const fingerprint: FileFingerprint = {
          inode: Number(st.ino),
          mtimeMs: st.mtimeMs,
          size: st.size,
        };
        const result = await codexTokenDriver.parse(
          filePath,
          codexTokenDriver.resumeState(undefined, fingerprint),
          goalCtx,
        );
        deltas.push(...result.deltas);
      }

      expect(deltas.reduce((sum, d) => sum + d.tokens.inputTokens, 0)).toBe(250);
      expect(goalCtx.codexFileScopes?.get(childPath)).toBe(goalId);
    });

    it("inherits the root scope from a parent that was not re-read this sync", async () => {
      // Regression: discovery only re-reads rollouts with no cached scope, so a
      // brand-new child names a parent that is absent from this run's node set.
      // Without the cached thread → scope map its chain dead-ends and it adopts
      // parentThreadId as its own scope, escaping the root scope's usage-edge
      // dedup and re-counting the replayed history.
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      const goalId = "019f9edc-bc7f-7ef1-8d32-35f66809b013";
      const parentThreadId = "019fbeda-8b7d-7b13-9eb3-87cecc4607e9";
      const childThreadId = "019fbf71-32f5-70d3-9113-2f8b4430656e";
      const parentPath = join(
        dayDir,
        `rollout-2026-03-07T10-00-00-${parentThreadId}.jsonl`,
      );
      const childPath = join(
        dayDir,
        `rollout-2026-03-07T10-30-00-${childThreadId}.jsonl`,
      );
      await writeFile(
        parentPath,
        `${[
          codexGoalSessionMeta({ id: goalId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10 }),
        ].join("\n")}\n`,
      );
      await writeFile(
        childPath,
        `${[
          codexGoalSessionMeta({ id: childThreadId, parentThreadId }),
          codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10 }),
          codexTokenLine({ input: 150, output: 15, lastInput: 50, lastOutput: 5 }),
        ].join("\n")}\n`,
      );

      // Second sync: the parent's scope is already cached, the child is new.
      const ctx: SyncContext = {
        codexKnownScopes: { [parentPath]: goalId },
        codexSeenUsageKeys: new Map([[goalId, new Set<string>()]]),
      };
      await codexTokenDriver.discover({ codexSessionsDir: tempDir }, ctx);

      expect(ctx.codexFileScopes?.get(parentPath)).toBe(goalId);
      expect(ctx.codexFileScopes?.get(childPath)).toBe(goalId);
    });

    it("counts both forked subagent branches instead of keeping only the highest branch", async () => {
      const dayDir = join(tempDir, "2026", "03", "07");
      await mkdir(dayDir, { recursive: true });
      const goalId = "019f9edc-bc7f-7ef1-8d32-35f66809b013";
      const parentThreadId = "019fbeda-8b7d-7b13-9eb3-87cecc4607e9";
      const childOneId = "019fbf71-32f5-70d3-9113-2f8b4430656e";
      const childTwoId = "019fbf72-32f5-70d3-9113-2f8b4430656f";
      const fixtures = [
        {
          path: join(dayDir, `rollout-2026-03-07T10-00-00-${parentThreadId}.jsonl`),
          lines: [
            codexGoalSessionMeta({ id: goalId }),
            codexTokenLine({ input: 100, output: 10, lastInput: 100, lastOutput: 10 }),
            codexTokenLine({ input: 200, output: 20, lastInput: 100, lastOutput: 10 }),
          ],
        },
        {
          path: join(dayDir, `rollout-2026-03-07T10-30-00-${childOneId}.jsonl`),
          lines: [
            codexGoalSessionMeta({ id: childOneId, parentThreadId }),
            codexTokenLine({ input: 250, output: 25, lastInput: 50, lastOutput: 5 }),
          ],
        },
        {
          path: join(dayDir, `rollout-2026-03-07T10-40-00-${childTwoId}.jsonl`),
          lines: [
            codexGoalSessionMeta({ id: childTwoId, parentThreadId }),
            codexTokenLine({ input: 260, output: 26, lastInput: 60, lastOutput: 6 }),
          ],
        },
      ];
      for (const fixture of fixtures) {
        await writeFile(fixture.path, `${fixture.lines.join("\n")}\n`);
      }

      const goalCtx: SyncContext = {};
      const files = await codexTokenDriver.discover({ codexSessionsDir: tempDir }, goalCtx);
      const deltas = [];
      for (const filePath of files) {
        const st = await import("node:fs/promises").then((m) => m.stat(filePath));
        const fingerprint: FileFingerprint = {
          inode: Number(st.ino),
          mtimeMs: st.mtimeMs,
          size: st.size,
        };
        const result = await codexTokenDriver.parse(
          filePath,
          codexTokenDriver.resumeState(undefined, fingerprint),
          goalCtx,
        );
        deltas.push(...result.deltas);
      }

      expect(deltas.reduce((sum, d) => sum + d.tokens.inputTokens, 0)).toBe(310);
      expect(deltas.reduce((sum, d) => sum + d.tokens.outputTokens, 0)).toBe(31);
      expect(goalCtx.codexFileScopes?.get(fixtures[1].path)).toBe(goalId);
      expect(goalCtx.codexFileScopes?.get(fixtures[2].path)).toBe(goalId);
    });

    it("requests a full replay for cursors created before usage-edge tracking", () => {
      const legacy = {
        inode: 500,
        mtimeMs: 1709827200000,
        size: 2048,
        offset: 300,
        lastTotals: null,
        lastModel: null,
        updatedAt: "2026-01-01T00:00:00Z",
      } as CodexCursor;
      expect(codexTokenDriver.needsReplay?.(legacy)).toBe(true);

      const current = { ...legacy, scopeId: null, usageKeys: [] } as CodexCursor & {
        scopeId: string | null;
      };
      expect(codexTokenDriver.needsReplay?.(current)).toBe(false);
    });
  });
});

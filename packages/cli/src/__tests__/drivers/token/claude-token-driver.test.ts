import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeTokenDriver } from "../../../drivers/token/claude-token-driver.js";
import type { ClaudeCursor, FileCursorBase } from "@pew/core";
import type { SyncContext, FileFingerprint } from "../../../drivers/types.js";

/** Helper: create a Claude-style JSONL line */
function claudeLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-03-07T10:15:30.000Z",
    message: {
      id: "msg_001",
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 5000,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 2000,
        output_tokens: 800,
      },
    },
    ...overrides,
  });
}

describe("claudeTokenDriver", () => {
  let tempDir: string;
  const ctx: SyncContext = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-claude-driver-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("has correct kind and source", () => {
    expect(claudeTokenDriver.kind).toBe("file");
    expect(claudeTokenDriver.source).toBe("claude-code");
  });

  describe("discover", () => {
    it("returns [] when claudeDir is not set", async () => {
      const files = await claudeTokenDriver.discover({}, ctx);
      expect(files).toEqual([]);
    });

    it("discovers JSONL files under claudeDir", async () => {
      const projectsDir = join(tempDir, "projects", "proj1");
      await mkdir(projectsDir, { recursive: true });
      await writeFile(join(projectsDir, "session.jsonl"), claudeLine() + "\n");
      await writeFile(join(projectsDir, "not-jsonl.txt"), "ignore");

      const files = await claudeTokenDriver.discover(
        { claudeDir: tempDir },
        ctx,
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("session.jsonl");
    });
  });

  describe("shouldSkip", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns false when cursor is undefined", () => {
      expect(claudeTokenDriver.shouldSkip(undefined, fingerprint)).toBe(false);
    });

    it("returns true when file is unchanged", () => {
      const cursor: ClaudeCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        seenIds: [],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(claudeTokenDriver.shouldSkip(cursor, fingerprint)).toBe(true);
    });

    it("returns false when mtimeMs differs", () => {
      const cursor: ClaudeCursor = {
        inode: 100,
        mtimeMs: 1709827100000,
        size: 4096,
        offset: 500,
        seenIds: [],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(claudeTokenDriver.shouldSkip(cursor, fingerprint)).toBe(false);
    });
  });

  describe("resumeState", () => {
    const fingerprint: FileFingerprint = {
      inode: 100,
      mtimeMs: 1709827200000,
      size: 4096,
    };

    it("returns offset 0 when no cursor", () => {
      const state = claudeTokenDriver.resumeState(undefined, fingerprint);
      expect(state).toEqual({ kind: "claude", startOffset: 0, priorSeenIds: [] });
    });

    it("returns stored offset when inode matches", () => {
      const cursor: ClaudeCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        seenIds: [],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = claudeTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "claude", startOffset: 500, priorSeenIds: [] });
    });

    it("resets offset to 0 when inode differs", () => {
      const cursor: ClaudeCursor = {
        inode: 999,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: 500,
        seenIds: [],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = claudeTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "claude", startOffset: 0, priorSeenIds: [] });
    });

    it("defaults offset to 0 when cursor.offset is undefined (old cursor format)", () => {
      const cursor: ClaudeCursor = {
        inode: 100,
        mtimeMs: 1709827200000,
        size: 4096,
        offset: undefined as unknown as number,
        seenIds: [],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const state = claudeTokenDriver.resumeState(cursor, fingerprint);
      expect(state).toEqual({ kind: "claude", startOffset: 0, priorSeenIds: [] });
    });
  });

  describe("parse + buildCursor", () => {
    it("parses JSONL and builds cursor with endOffset", async () => {
      const filePath = join(tempDir, "session.jsonl");
      const content = claudeLine() + "\n";
      await writeFile(filePath, content);

      const resume = { kind: "claude" as const, startOffset: 0, priorSeenIds: [] };
      const result = await claudeTokenDriver.parse(filePath, resume, ctx);

      expect(result.deltas).toHaveLength(1);
      expect(result.deltas[0].source).toBe("claude-code");
      expect(result.deltas[0].tokens.inputTokens).toBe(5100);
      expect(result.deltas[0].tokens.outputTokens).toBe(800);

      const fingerprint: FileFingerprint = {
        inode: 100,
        mtimeMs: Date.now(),
        size: content.length,
      };
      const cursor = claudeTokenDriver.buildCursor(fingerprint, result);
      expect(cursor.inode).toBe(100);
      expect(cursor.offset).toBeGreaterThan(0);
      expect(cursor.updatedAt).toBeDefined();
    });

    it("resumes parsing from byte offset", async () => {
      const filePath = join(tempDir, "session.jsonl");
      // Use distinct ids so the dedup layer doesn't collapse them —
      // this test targets the byte-offset resume mechanic, not dedup.
      const line1 = claudeLine({
        timestamp: "2026-03-07T10:00:00.000Z",
        message: {
          id: "msg_resume_a",
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 5000, output_tokens: 800 },
        },
      });
      const line2 = claudeLine({
        timestamp: "2026-03-07T10:30:00.000Z",
        message: {
          id: "msg_resume_b",
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 5000, output_tokens: 800 },
        },
      });
      await writeFile(filePath, line1 + "\n" + line2 + "\n");

      // Fresh context so the resume test isn't affected by other tests'
      // shared `ctx`. Byte-offset resume must work regardless of dedup state.
      const localCtx: SyncContext = {};
      const result1 = await claudeTokenDriver.parse(filePath, { kind: "claude", startOffset: 0, priorSeenIds: [] }, localCtx);
      expect(result1.deltas).toHaveLength(2);

      // Build cursor with endOffset
      const endOffset = (result1 as unknown as { endOffset: number }).endOffset;

      // Parse from offset — nothing new
      const result2 = await claudeTokenDriver.parse(filePath, { kind: "claude", startOffset: endOffset, priorSeenIds: [] }, localCtx);
      expect(result2.deltas).toHaveLength(0);
    });
  });

  describe("cross-file message.id dedup", () => {
    it("dedups a repeated message.id across two files in one sync", async () => {
      // Real-world case: Claude Code can persist the same assistant message
      // to two different session files (e.g. a subagent parent shares
      // sessionId+message.id with its child). Without cross-file dedup,
      // both files count the same usage and inflate totals.
      const projectsDir = join(tempDir, "projects", "proj1");
      await mkdir(projectsDir, { recursive: true });
      const fileA = join(projectsDir, "sessionA.jsonl");
      const fileB = join(projectsDir, "sessionB.jsonl");
      const shared = claudeLine(); // both use the default id "msg_001"
      await writeFile(fileA, shared + "\n");
      await writeFile(fileB, shared + "\n");

      // Simulate the orchestrator flow: discover initializes ctx, then
      // parse is called per file. The driver must dedup across those calls.
      const freshCtx: SyncContext = {};
      await claudeTokenDriver.discover({ claudeDir: tempDir }, freshCtx);

      const rA = await claudeTokenDriver.parse(
        fileA,
        { kind: "claude", startOffset: 0, priorSeenIds: [] },
        freshCtx,
      );
      const rB = await claudeTokenDriver.parse(
        fileB,
        { kind: "claude", startOffset: 0, priorSeenIds: [] },
        freshCtx,
      );
      expect(rA.deltas).toHaveLength(1);
      expect(rB.deltas).toHaveLength(0);
    });

    it("does not dedup across independent sync contexts", async () => {
      // Two syncs (two different SyncContexts) must not share state —
      // otherwise a long-running daemon would slowly lose valid deltas.
      const projectsDir = join(tempDir, "projects", "proj1");
      await mkdir(projectsDir, { recursive: true });
      const fileA = join(projectsDir, "sessionA.jsonl");
      await writeFile(fileA, claudeLine() + "\n");

      const ctx1: SyncContext = {};
      await claudeTokenDriver.discover({ claudeDir: tempDir }, ctx1);
      const r1 = await claudeTokenDriver.parse(
        fileA,
        { kind: "claude", startOffset: 0, priorSeenIds: [] },
        ctx1,
      );
      expect(r1.deltas).toHaveLength(1);

      const ctx2: SyncContext = {};
      await claudeTokenDriver.discover({ claudeDir: tempDir }, ctx2);
      const r2 = await claudeTokenDriver.parse(
        fileA,
        { kind: "claude", startOffset: 0, priorSeenIds: [] },
        ctx2,
      );
      // Different context → dedup Set is fresh → the same file's message
      // counts again. Byte-offset skip in the real orchestrator prevents
      // re-reading, but the parser itself must remain honest per-context.
      expect(r2.deltas).toHaveLength(1);
    });
  });

  describe("cross-sync dedup via persisted cursor.seenIds", () => {
    it("does not double-count a message.id appended in a later sync", async () => {
      // Real incremental-sync scenario:
      //   sync #1: file has msg_A → recorded, cursor.offset advanced
      //   sync #2: file appended with msg_A again → parser reads new bytes
      //   only. Fresh SyncContext means an empty in-process Set, so without
      //   a cursor-persisted seenIds the id counts twice.
      const filePath = join(tempDir, "session.jsonl");
      const line = (ts: string) =>
        claudeLine({
          timestamp: ts,
          message: {
            id: "msg_A",
            model: "claude-sonnet-4",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        });
      await writeFile(filePath, line("2026-03-07T10:00:00.000Z") + "\n");

      // ---- SYNC #1 ----
      const ctx1: SyncContext = {};
      const resume1 = claudeTokenDriver.resumeState(undefined, {
        inode: 42,
        mtimeMs: Date.now(),
        size: 100,
      });
      const r1 = await claudeTokenDriver.parse(filePath, resume1, ctx1);
      expect(r1.deltas).toHaveLength(1);
      const fp1: FileFingerprint = {
        inode: 42,
        mtimeMs: Date.now(),
        size: 100,
      };
      const cursor1 = claudeTokenDriver.buildCursor(fp1, r1) as ClaudeCursor;
      expect(cursor1.seenIds).toContain("msg_A");

      // ---- File grows (append same id) ----
      await appendFile(filePath, line("2026-03-07T11:00:00.000Z") + "\n");

      // ---- SYNC #2 (fresh ctx, cursor from sync #1) ----
      const ctx2: SyncContext = {};
      const fp2: FileFingerprint = {
        inode: 42,
        mtimeMs: Date.now() + 1,
        size: 200,
      };
      const resume2 = claudeTokenDriver.resumeState(cursor1, fp2);
      const r2 = await claudeTokenDriver.parse(filePath, resume2, ctx2);
      // The appended line has the same message.id → must NOT count again.
      expect(r2.deltas).toHaveLength(0);
    });

    it("still counts a genuinely new id appended in a later sync", async () => {
      // Symmetry check: a NEW id after the cursor must count. Otherwise
      // the persisted seenIds guard could over-suppress and lose data.
      const filePath = join(tempDir, "session.jsonl");
      await writeFile(
        filePath,
        claudeLine({
          message: {
            id: "msg_first",
            model: "m",
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }) + "\n",
      );
      const ctx1: SyncContext = {};
      const fp1: FileFingerprint = { inode: 7, mtimeMs: 1, size: 100 };
      const resume1 = claudeTokenDriver.resumeState(undefined, fp1);
      const r1 = await claudeTokenDriver.parse(filePath, resume1, ctx1);
      const cursor1 = claudeTokenDriver.buildCursor(fp1, r1) as ClaudeCursor;

      await appendFile(
        filePath,
        claudeLine({
          message: {
            id: "msg_second",
            model: "m",
            usage: { input_tokens: 20, output_tokens: 10 },
          },
        }) + "\n",
      );

      const ctx2: SyncContext = {};
      const fp2: FileFingerprint = { inode: 7, mtimeMs: 2, size: 200 };
      const resume2 = claudeTokenDriver.resumeState(cursor1, fp2);
      const r2 = await claudeTokenDriver.parse(filePath, resume2, ctx2);
      expect(r2.deltas).toHaveLength(1);
      expect(r2.deltas[0].tokens.inputTokens).toBe(20);
    });

    it("bounds seenIds so the cursor cannot grow unbounded", async () => {
      // Long-running files must not accumulate seenIds forever. Real Claude
      // Code duplicates cluster within ~a few dozen lines (streaming retries,
      // subagent handoffs), so keeping the last N is sufficient.
      const filePath = join(tempDir, "session.jsonl");
      const lines: string[] = [];
      for (let i = 0; i < 500; i++) {
        lines.push(
          claudeLine({
            timestamp: `2026-03-07T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
            message: {
              id: `msg_${i}`,
              model: "m",
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          }),
        );
      }
      await writeFile(filePath, lines.join("\n") + "\n");

      const ctx: SyncContext = {};
      const fp: FileFingerprint = { inode: 9, mtimeMs: 1, size: 100000 };
      const resume = claudeTokenDriver.resumeState(undefined, fp);
      const r = await claudeTokenDriver.parse(filePath, resume, ctx);
      expect(r.deltas).toHaveLength(500);
      const cursor = claudeTokenDriver.buildCursor(fp, r) as ClaudeCursor;
      // Cap must exist; exact value is an implementation choice, but it
      // must not equal the total number of ids seen this sync.
      expect(cursor.seenIds.length).toBeLessThan(500);
      // And it must retain the most recent tail (that's where duplicates
      // cluster in the streaming/retry pattern).
      expect(cursor.seenIds).toContain("msg_499");
    });

    it("resets seenIds when inode changes (file rotation)", async () => {
      // If the file was rotated (new inode), the byte offset resets to 0
      // and any persisted seenIds from the old file are meaningless.
      const filePath = join(tempDir, "session.jsonl");
      await writeFile(filePath, claudeLine() + "\n");

      const staleCursor: ClaudeCursor = {
        inode: 999,
        mtimeMs: 1,
        size: 50,
        offset: 50,
        seenIds: ["msg_001"], // matches default id — would suppress if not reset
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const freshFp: FileFingerprint = {
        inode: 1000, // rotated
        mtimeMs: 2,
        size: 100,
      };
      const ctx: SyncContext = {};
      const resume = claudeTokenDriver.resumeState(staleCursor, freshFp);
      const r = await claudeTokenDriver.parse(filePath, resume, ctx);
      expect(r.deltas).toHaveLength(1); // NOT suppressed by stale seenIds
    });

    it("preload seeds ctx with seenIds from ALL cursors, including files that will be fast-skipped", async () => {
      // Real-world case: file A recorded msg_cross in sync #1 and is
      // unchanged in sync #2 (shouldSkip returns true, parse never runs
      // for A). File B is a NEW file that also carries msg_cross (subagent
      // parent/child sharing the same message.id). Without a preload pass,
      // A's cursor.seenIds never reach the ctx Set and B's line double-counts.
      //
      // preload() runs once before the per-file skip/parse loop and lifts
      // seenIds from every known cursor into ctx.seenClaudeMessageIds so
      // dedup survives fast-skip.
      expect(claudeTokenDriver.preload).toBeDefined();

      const cursorA: ClaudeCursor = {
        inode: 1,
        mtimeMs: 1,
        size: 100,
        offset: 100,
        seenIds: ["msg_cross"],
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const cursors: Record<string, FileCursorBase> = {
        "/fake/A.jsonl": cursorA,
      };
      const ctx: SyncContext = {};
      claudeTokenDriver.preload!(cursors, ctx);
      expect(ctx.seenClaudeMessageIds?.has("msg_cross")).toBe(true);
    });

    it("preload is idempotent and merges into an existing Set", async () => {
      const cursors: Record<string, FileCursorBase> = {
        "/fake/A.jsonl": {
          inode: 1,
          mtimeMs: 1,
          size: 100,
          offset: 100,
          seenIds: ["msg_A"],
          updatedAt: "2026-01-01T00:00:00Z",
        } as ClaudeCursor,
        "/fake/B.jsonl": {
          inode: 2,
          mtimeMs: 2,
          size: 100,
          offset: 100,
          seenIds: ["msg_B"],
          updatedAt: "2026-01-01T00:00:00Z",
        } as ClaudeCursor,
      };
      const ctx: SyncContext = { seenClaudeMessageIds: new Set(["preexisting"]) };
      claudeTokenDriver.preload!(cursors, ctx);
      expect(ctx.seenClaudeMessageIds?.has("msg_A")).toBe(true);
      expect(ctx.seenClaudeMessageIds?.has("msg_B")).toBe(true);
      expect(ctx.seenClaudeMessageIds?.has("preexisting")).toBe(true);
    });

    it("declares needsReplay=true for a legacy cursor (no seenIds field)", async () => {
      // Upgrade path: an existing install has ByteOffsetCursor-shaped
      // entries in cursors.json with no `seenIds` field. Rescanning that
      // file inside incremental mode would double-count into the SUM'd
      // queue. The driver flags this via needsReplay(); the orchestrator
      // then wipes cursors and restarts as a full scan (overwrite branch).
      const legacyCursor = {
        inode: 42,
        mtimeMs: 1709827200000,
        size: 200,
        offset: 200,
        updatedAt: "2026-06-01T00:00:00Z",
        // no seenIds — legacy shape
      } as unknown as ClaudeCursor;
      expect(claudeTokenDriver.needsReplay).toBeDefined();
      expect(claudeTokenDriver.needsReplay!(legacyCursor)).toBe(true);

      // shouldSkip / resumeState treat a legacy cursor like any other
      // cursor; the replay decision is the orchestrator's, not theirs.
      // (This keeps those two methods pure and predictable.)
      const fp: FileFingerprint = { inode: 42, mtimeMs: 1709827200000, size: 200 };
      expect(claudeTokenDriver.shouldSkip(legacyCursor, fp)).toBe(true);
    });

    it("does not flag modern or missing cursors as needsReplay", async () => {
      expect(claudeTokenDriver.needsReplay!(undefined)).toBe(false);
      const modern: ClaudeCursor = {
        inode: 1,
        mtimeMs: 1,
        size: 1,
        offset: 1,
        seenIds: [],
        updatedAt: "2026-06-01T00:00:00Z",
      };
      expect(claudeTokenDriver.needsReplay!(modern)).toBe(false);
    });

    it("preload treats legacy cursors (no seenIds) as contributing nothing", async () => {
      // Legacy cursors don't crash preload and don't inject stale ids.
      const cursors: Record<string, FileCursorBase> = {
        "/fake/legacy.jsonl": {
          inode: 5,
          mtimeMs: 5,
          size: 100,
          offset: 100,
          updatedAt: "2026-06-01T00:00:00Z",
          // no seenIds field
        } as unknown as ClaudeCursor,
      };
      const ctx: SyncContext = {};
      claudeTokenDriver.preload!(cursors, ctx);
      expect(ctx.seenClaudeMessageIds?.size ?? 0).toBe(0);
    });

    it("upgraded (non-legacy) cursor with empty seenIds still fast-skips normally", async () => {
      // A cursor that has an explicit empty seenIds array is NOT legacy —
      // it's a modern cursor for a file whose recent tail happened to have
      // no dedupable ids. Fast-skip must still work when the file is unchanged.
      const modernEmpty: ClaudeCursor = {
        inode: 42,
        mtimeMs: 1709827200000,
        size: 200,
        offset: 200,
        seenIds: [], // explicitly empty, not missing
        updatedAt: "2026-06-01T00:00:00Z",
      };
      const fp: FileFingerprint = {
        inode: 42,
        mtimeMs: 1709827200000,
        size: 200,
      };
      expect(claudeTokenDriver.shouldSkip(modernEmpty, fp)).toBe(true);
    });
  });
});

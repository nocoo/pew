import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CONTINUITY_ANCHOR_COUNT,
  applyResumeStartOffset,
  hashRecord,
  isOffsetCursor,
  readContinuityAnchors,
  resolveJsonlContinuity,
  usesJsonlOffsetResume,
} from "../utils/continuity-anchor.js";

function rec(id: string): Buffer {
  return Buffer.from(`{"id":"${id}"}\n`, "utf8");
}

describe("usesJsonlOffsetResume", () => {
  it("covers every offset JSONL source and excludes vscode json", () => {
    expect(usesJsonlOffsetResume("grok", "/x/unified.jsonl")).toBe(true);
    expect(usesJsonlOffsetResume("claude-code", "/x/a.jsonl")).toBe(true);
    expect(usesJsonlOffsetResume("codex", "/x/rollout.jsonl")).toBe(true);
    expect(usesJsonlOffsetResume("openclaw", "/x/s.jsonl")).toBe(true);
    expect(usesJsonlOffsetResume("pi", "/x/s.jsonl")).toBe(true);
    expect(usesJsonlOffsetResume("omp", "/x/s.jsonl")).toBe(true);
    expect(usesJsonlOffsetResume("copilot-cli", "/x/process.log")).toBe(true);
    expect(usesJsonlOffsetResume("vscode-copilot", "/x/edit.jsonl")).toBe(true);
    expect(usesJsonlOffsetResume("vscode-copilot", "/x/edit.json")).toBe(false);
    expect(usesJsonlOffsetResume("gemini-cli", "/x/session.json")).toBe(false);
    expect(usesJsonlOffsetResume("hermes", "/x/state.db")).toBe(false);
  });
});

describe("isOffsetCursor / applyResumeStartOffset", () => {
  it("detects offset cursors", () => {
    expect(isOffsetCursor(undefined)).toBe(false);
    expect(
      isOffsetCursor({
        inode: 1,
        mtimeMs: 1,
        size: 10,
        updatedAt: "t",
      }),
    ).toBe(false);
    expect(
      isOffsetCursor({
        inode: 1,
        mtimeMs: 1,
        size: 10,
        offset: 10,
        updatedAt: "t",
      }),
    ).toBe(true);
  });

  it("patches startOffset in place", () => {
    const resume = { kind: "byte-offset" as const, startOffset: 99 };
    applyResumeStartOffset(resume, 12);
    expect(resume.startOffset).toBe(12);
    applyResumeStartOffset({ kind: "array-index" }, 3);
  });
});

describe("readContinuityAnchors / resolveJsonlContinuity", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-continuity-"));
    filePath = join(dir, "log.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps at most three trailing complete records", async () => {
    const body = Buffer.concat([rec("a"), rec("b"), rec("c"), rec("d")]);
    await writeFile(filePath, body);
    const anchors = await readContinuityAnchors(filePath, body.length);
    expect(anchors).toHaveLength(CONTINUITY_ANCHOR_COUNT);
    expect(anchors.map((a) => a.length)).toEqual([
      rec("b").length,
      rec("c").length,
      rec("d").length,
    ]);
    expect(anchors[2]!.sha256).toBe(hashRecord(rec("d")));
  });

  it("appends when anchors still sit immediately before offset", async () => {
    const body = Buffer.concat([rec("a"), rec("b"), rec("c")]);
    await writeFile(filePath, body);
    const anchors = await readContinuityAnchors(filePath, body.length);
    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: body.length,
      cursorSize: body.length,
      offset: body.length,
      anchors,
    });
    expect(decision).toEqual({ action: "append", startOffset: body.length });
  });

  it("rebases after a retained suffix plus new content", async () => {
    const dropped = rec("old");
    const kept = Buffer.concat([rec("a"), rec("b"), rec("c")]);
    const original = Buffer.concat([dropped, kept]);
    await writeFile(filePath, original);
    const anchors = await readContinuityAnchors(filePath, original.length);

    const added = rec("new");
    const rewritten = Buffer.concat([kept, added]);
    await writeFile(filePath, rewritten);

    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: rewritten.length,
      cursorSize: original.length,
      offset: original.length,
      anchors,
    });
    expect(decision).toEqual({ action: "rebase", startOffset: kept.length });
  });

  it("rebases after shrink then regrowth past the old size", async () => {
    const dropped = Buffer.concat([rec("x"), rec("y")]);
    const kept = Buffer.concat([rec("a"), rec("b"), rec("c")]);
    const original = Buffer.concat([dropped, kept]);
    await writeFile(filePath, original);
    const anchors = await readContinuityAnchors(filePath, original.length);

    const grown = Buffer.concat([kept, rec("n1"), rec("n2"), rec("n3")]);
    expect(grown.length).toBeGreaterThan(original.length);
    await writeFile(filePath, grown);

    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: grown.length,
      cursorSize: original.length,
      offset: original.length,
      anchors,
    });
    expect(decision).toEqual({ action: "rebase", startOffset: kept.length });
  });

  it("skips an equal-size rewrite whose records do not match", async () => {
    const original = Buffer.concat([rec("aaa"), rec("bbb"), rec("ccc")]);
    const rewritten = Buffer.concat([rec("xxx"), rec("yyy"), rec("zzz")]);
    expect(rewritten.length).toBe(original.length);
    await writeFile(filePath, original);
    const anchors = await readContinuityAnchors(filePath, original.length);
    await writeFile(filePath, rewritten);

    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: rewritten.length,
      cursorSize: original.length,
      offset: original.length,
      anchors,
    });
    expect(decision).toEqual({ action: "skip", reason: "unproven-discontinuity" });
  });

  it("skips a clear rewrite with no matching anchors", async () => {
    const original = Buffer.concat([rec("a"), rec("b"), rec("c")]);
    await writeFile(filePath, original);
    const anchors = await readContinuityAnchors(filePath, original.length);
    const rewritten = Buffer.concat([rec("x"), rec("y"), rec("z")]);
    await writeFile(filePath, rewritten);

    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: rewritten.length,
      cursorSize: original.length,
      offset: original.length,
      anchors,
    });
    expect(decision).toEqual({ action: "skip", reason: "unproven-discontinuity" });
  });

  it("skips a legacy cursor whose file shrank", async () => {
    const original = Buffer.concat([rec("a"), rec("b"), rec("c")]);
    await writeFile(filePath, original);
    const shrunk = rec("c");
    await writeFile(filePath, shrunk);

    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: shrunk.length,
      cursorSize: original.length,
      offset: original.length,
      anchors: undefined,
    });
    expect(decision).toEqual({ action: "skip", reason: "unproven-discontinuity" });
  });

  it("skips a poisoned offset past EOF without anchors", async () => {
    const body = rec("a");
    await writeFile(filePath, body);
    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: body.length,
      cursorSize: 80,
      offset: 5240354,
      anchors: undefined,
    });
    expect(decision).toEqual({ action: "skip", reason: "unproven-discontinuity" });
  });

  it("returns no anchors when the file cannot be read", async () => {
    expect(await readContinuityAnchors(join(dir, "missing.jsonl"), 10)).toEqual([]);
  });

  it("returns no anchors at offset 0", async () => {
    await writeFile(filePath, rec("a"));
    expect(await readContinuityAnchors(filePath, 0)).toEqual([]);
  });

  it("hashes CRLF records without the terminator", () => {
    const lf = Buffer.from('{"id":"a"}\n');
    const crlf = Buffer.from('{"id":"a"}\r\n');
    expect(hashRecord(lf)).toBe(hashRecord(crlf));
  });

  it("skips when the log path cannot be read with anchors", async () => {
    const decision = await resolveJsonlContinuity({
      filePath: join(dir, "missing.jsonl"),
      fileSize: 10,
      cursorSize: 10,
      offset: 99,
      anchors: [{ sha256: "ab", length: 3 }],
    });
    expect(decision).toEqual({ action: "skip", reason: "unproven-discontinuity" });
  });

  it("skips a legacy equal-size rewrite", async () => {
    const body = Buffer.concat([rec("a"), rec("b")]);
    await writeFile(filePath, body);
    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: body.length,
      cursorSize: body.length,
      offset: body.length,
      anchors: undefined,
    });
    expect(decision).toEqual({ action: "skip", reason: "unproven-discontinuity" });
  });

  it("reads an anchor when the last record is larger than 1 MiB", async () => {
    const huge = Buffer.from(`{"id":"${"x".repeat(1_100_000)}"}\n`);
    const tail = rec("z");
    const body = Buffer.concat([huge, tail]);
    await writeFile(filePath, body);
    const anchors = await readContinuityAnchors(filePath, body.length);
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors[anchors.length - 1]?.sha256).toBe(hashRecord(tail));
  });

  it("appends a legacy cursor when the file only grew", async () => {
    const body = Buffer.concat([rec("a"), rec("b")]);
    await writeFile(filePath, body);
    const decision = await resolveJsonlContinuity({
      filePath,
      fileSize: body.length + 10,
      cursorSize: body.length,
      offset: body.length,
      anchors: undefined,
    });
    expect(decision).toEqual({ action: "append", startOffset: body.length });
  });
});

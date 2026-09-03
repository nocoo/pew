import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileCursor } from "@pew/core";
import type { TokenParseResult } from "../drivers/types.js";
import {
  clampedJsonlEndOffset,
  hashJsonlPrefix,
  parseStableJsonlFile,
} from "../utils/jsonl-offset.js";

function deltaResult(inputTokens: number): TokenParseResult {
  return {
    deltas: [
      {
        source: "grok",
        model: "g",
        timestamp: "2026-03-07T10:00:00.000Z",
        tokens: {
          inputTokens,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
      },
    ],
  };
}

function offsetCursor(size: number, offset = size): FileCursor {
  return {
    inode: 1,
    mtimeMs: 1,
    size,
    offset,
    updatedAt: "t",
  };
}

describe("hashJsonlPrefix", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-jsonl-hash-"));
    filePath = join(dir, "log.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("hashes exactly snapshotSize bytes", async () => {
    const body = '{"a":1}\n{"b":2}\n';
    await writeFile(filePath, body);
    const expected = createHash("sha256").update(body, "utf8").digest("hex");
    expect(await hashJsonlPrefix(filePath, body.length)).toBe(expected);
  });

  it("ignores bytes appended past the snapshot", async () => {
    const prefix = '{"a":1}\n';
    await writeFile(filePath, `${prefix}{"b":2}\n`);
    const expected = createHash("sha256").update(prefix, "utf8").digest("hex");
    expect(await hashJsonlPrefix(filePath, prefix.length)).toBe(expected);
  });

  it("returns null when the file is shorter than the snapshot", async () => {
    await writeFile(filePath, "ab");
    expect(await hashJsonlPrefix(filePath, 10)).toBeNull();
  });

  it("returns null when the file is missing", async () => {
    expect(await hashJsonlPrefix(join(dir, "missing.jsonl"), 4)).toBeNull();
  });

  it("returns null for a negative snapshot size", async () => {
    await writeFile(filePath, "ab");
    expect(await hashJsonlPrefix(filePath, -1)).toBeNull();
  });

  it("hashes an empty snapshot as the empty digest", async () => {
    await writeFile(filePath, "");
    expect(await hashJsonlPrefix(filePath, 0)).toBe(
      createHash("sha256").digest("hex"),
    );
  });
});

describe("parseStableJsonlFile", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-jsonl-stable-"));
    filePath = join(dir, "log.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("commits the parse and stamps anchors when the prefix is unchanged", async () => {
    const body = '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n';
    await writeFile(filePath, body);
    const committed = await parseStableJsonlFile({
      filePath,
      snapshotSize: body.length,
      parse: async () => deltaResult(3),
      buildCursor: () => offsetCursor(body.length),
    });
    expect(committed?.result.deltas[0]?.tokens.inputTokens).toBe(3);
    expect(committed?.cursor.continuityAnchors?.length).toBeGreaterThan(0);
    expect(committed?.cursor.continuityBroken).toBeUndefined();
  });

  it("discards a nonzero-delta parse after an equal-size rewrite", async () => {
    const original = '{"id":"keep"}\n{"id":"old"}\n';
    await writeFile(filePath, original);
    const committed = await parseStableJsonlFile({
      filePath,
      snapshotSize: original.length,
      parse: async () => {
        await writeFile(filePath, '{"id":"new1"}\n{"id":"new2"}\n');
        return deltaResult(99);
      },
      buildCursor: () => offsetCursor(original.length),
    });
    expect(committed).toBeNull();
  });

  it("discards a nonzero-delta parse after a shrink that still leaves unread bytes", async () => {
    const original = '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n';
    await writeFile(filePath, original);
    const committed = await parseStableJsonlFile({
      filePath,
      snapshotSize: original.length,
      parse: async () => {
        await writeFile(filePath, '{"id":"b"}\n{"id":"c"}\n');
        return deltaResult(40);
      },
      buildCursor: () => offsetCursor(original.length),
    });
    expect(committed).toBeNull();
  });

  it("discards when the file vanishes before anchors can be proven", async () => {
    const body = '{"id":"a"}\n';
    await writeFile(filePath, body);
    const committed = await parseStableJsonlFile({
      filePath,
      snapshotSize: body.length,
      parse: async () => {
        await rm(filePath);
        return deltaResult(1);
      },
      buildCursor: () => offsetCursor(body.length),
    });
    expect(committed).toBeNull();
  });

  it("keeps an append past the snapshot when the original prefix is intact", async () => {
    const prefix = '{"id":"a"}\n{"id":"b"}\n';
    await writeFile(filePath, prefix);
    const committed = await parseStableJsonlFile({
      filePath,
      snapshotSize: prefix.length,
      parse: async () => {
        await writeFile(filePath, `${prefix}{"id":"c"}\n`);
        return deltaResult(7);
      },
      buildCursor: () => offsetCursor(prefix.length),
    });
    expect(committed?.result.deltas[0]?.tokens.inputTokens).toBe(7);
  });

  it("returns null when the prefix cannot be hashed", async () => {
    const committed = await parseStableJsonlFile({
      filePath: join(dir, "missing.jsonl"),
      snapshotSize: 4,
      parse: async () => deltaResult(1),
      buildCursor: () => offsetCursor(4),
    });
    expect(committed).toBeNull();
  });

  it("returns null when parse yields null", async () => {
    const body = '{"id":"a"}\n';
    await writeFile(filePath, body);
    const committed = await parseStableJsonlFile({
      filePath,
      snapshotSize: body.length,
      parse: async () => null,
      buildCursor: () => offsetCursor(body.length),
    });
    expect(committed).toBeNull();
  });

  it("treats a non-offset cursor as offset 0 when capturing anchors", async () => {
    const body = '{"id":"a"}\n';
    await writeFile(filePath, body);
    const committed = await parseStableJsonlFile({
      filePath,
      snapshotSize: body.length,
      parse: async () => deltaResult(1),
      buildCursor: () => ({
        inode: 1,
        mtimeMs: 1,
        size: body.length,
        updatedAt: "t",
      }) as FileCursor,
    });
    expect(committed?.cursor.continuityAnchors).toEqual([]);
  });
});

describe("clampedJsonlEndOffset", () => {
  it("returns file size when startOffset is past EOF", () => {
    expect(clampedJsonlEndOffset(5240354, 2800)).toBe(2800);
  });

  it("returns file size when startOffset equals size", () => {
    expect(clampedJsonlEndOffset(100, 100)).toBe(100);
  });

  it("adds complete bytes without passing the snapshot size", () => {
    expect(clampedJsonlEndOffset(10, 100, 20)).toBe(30);
    expect(clampedJsonlEndOffset(10, 25, 20)).toBe(25);
  });

  it("returns 0 for empty files", () => {
    expect(clampedJsonlEndOffset(0, 0, 10)).toBe(0);
  });
});

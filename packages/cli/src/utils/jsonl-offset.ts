import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { FileCursor } from "@pew/core";
import type { TokenParseResult } from "../drivers/types.js";
import { isOffsetCursor, readContinuityAnchors } from "./continuity-anchor.js";

const HASH_CHUNK = 64 * 1024;

/** Exclusive byte bound for a JSONL read pinned to a snapshot. */
export function jsonlStreamBound(fileSize: number, endBound?: number): number {
  if (fileSize <= 0) return 0;
  if (endBound === undefined || endBound < 0) return fileSize;
  return Math.min(fileSize, endBound);
}

/** Snapshot-pinned exclusive end that stops after the last complete JSONL record. */
export async function jsonlCompleteBound(
  filePath: string,
  startOffset: number,
  fileSize: number,
  endBound?: number,
): Promise<number> {
  const bound = jsonlStreamBound(fileSize, endBound);
  if (startOffset >= bound) return bound;
  return (await lastCompleteJsonlOffset(filePath, startOffset, bound)) ?? startOffset;
}

/** Last offset at or before `bound` that ends a complete newline-terminated record. */
export async function lastCompleteJsonlOffset(
  filePath: string,
  startOffset: number,
  bound: number,
): Promise<number | null> {
  if (bound <= startOffset) return startOffset;
  try {
    const handle = await open(filePath, "r");
    try {
      let pos = bound;
      const buf = Buffer.alloc(Math.min(HASH_CHUNK, bound - startOffset));
      while (pos > startOffset) {
        const start = Math.max(startOffset, pos - buf.length);
        const len = pos - start;
        const { bytesRead } = await handle.read(buf, 0, len, start);
        if (bytesRead !== len) return null;
        const data = buf.subarray(0, bytesRead);
        const nl = data.lastIndexOf(0x0a);
        if (nl !== -1) return start + nl + 1;
        pos = start;
      }
      return startOffset;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** SHA-256 of bytes [start, end). Null if the range is unreadable. */
export async function hashJsonlSlice(
  filePath: string,
  start: number,
  end: number,
): Promise<string | null> {
  if (start < 0 || end < start) return null;
  const size = end - start;
  try {
    const handle = await open(filePath, "r");
    try {
      const hash = createHash("sha256");
      let remaining = size;
      let pos = start;
      const buf = Buffer.alloc(Math.min(HASH_CHUNK, Math.max(size, 1)));
      while (remaining > 0) {
        const toRead = Math.min(buf.length, remaining);
        const { bytesRead } = await handle.read(buf, 0, toRead, pos);
        if (bytesRead !== toRead) return null;
        hash.update(buf.subarray(0, bytesRead));
        pos += bytesRead;
        remaining -= bytesRead;
      }
      return hash.digest("hex");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Parse a JSONL unread slice only if it stays unchanged through parse and
 * anchor capture. Returns null to discard the parse.
 */
export async function parseStableJsonlFile(opts: {
  filePath: string;
  startOffset: number;
  snapshotSize: number;
  parse: () => Promise<TokenParseResult | null>;
  buildCursor: (result: TokenParseResult) => FileCursor;
  confirm?: () => Promise<boolean>;
}): Promise<{ result: TokenParseResult; cursor: FileCursor } | null> {
  const pre = await hashJsonlSlice(opts.filePath, opts.startOffset, opts.snapshotSize);
  if (pre === null) return null;
  if (opts.confirm && !(await opts.confirm())) return null;
  const result = await opts.parse();
  if (!result) return null;
  const cursor = opts.buildCursor(result);
  const offset = isOffsetCursor(cursor) ? cursor.offset : 0;
  if (offset > opts.snapshotSize) return null;
  const anchors = await readContinuityAnchors(opts.filePath, offset);
  if (anchors === null) return null;
  if (opts.confirm && !(await opts.confirm())) return null;
  const post = await hashJsonlSlice(opts.filePath, opts.startOffset, opts.snapshotSize);
  if (post !== pre) return null;
  cursor.continuityAnchors = anchors;
  cursor.continuityBroken = undefined;
  return { result, cursor };
}

/** End offset for a JSONL parse pinned to a stat snapshot. */
export function clampedJsonlEndOffset(
  startOffset: number,
  fileSize: number,
  completeBytes = 0,
): number {
  if (fileSize <= 0) return 0;
  if (startOffset >= fileSize) return fileSize;
  return Math.min(fileSize, startOffset + completeBytes);
}

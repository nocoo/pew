import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { FileCursor } from "@pew/core";
import type { TokenParseResult } from "../drivers/types.js";
import { isOffsetCursor, readContinuityAnchors } from "./continuity-anchor.js";

const HASH_CHUNK = 64 * 1024;

/** SHA-256 of bytes [0, size). Null if the file is shorter or unreadable. */
export async function hashJsonlPrefix(
  filePath: string,
  size: number,
): Promise<string | null> {
  if (size < 0) return null;
  try {
    const handle = await open(filePath, "r");
    try {
      const hash = createHash("sha256");
      let remaining = size;
      let pos = 0;
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
 * Parse a JSONL file only if the orchestrator snapshot prefix is unchanged
 * through parse and anchor capture. Returns null to discard the parse.
 */
export async function parseStableJsonlFile(opts: {
  filePath: string;
  snapshotSize: number;
  parse: () => Promise<TokenParseResult | null>;
  buildCursor: (result: TokenParseResult) => FileCursor;
}): Promise<{ result: TokenParseResult; cursor: FileCursor } | null> {
  const pre = await hashJsonlPrefix(opts.filePath, opts.snapshotSize);
  if (pre === null) return null;
  const result = await opts.parse();
  if (!result) return null;
  const cursor = opts.buildCursor(result);
  const offset = isOffsetCursor(cursor) ? cursor.offset : 0;
  const anchors = await readContinuityAnchors(opts.filePath, offset);
  if (anchors === null) return null;
  const post = await hashJsonlPrefix(opts.filePath, opts.snapshotSize);
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

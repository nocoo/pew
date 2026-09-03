/**
 * Same-inode JSONL continuity: detect tail-trim / in-place rewrite and
 * rebase the byte-offset resume point without SUM-inflating retained
 * records or overwriting queue buckets.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { ContinuityAnchor, FileCursorBase, Source } from "@pew/core";

export type { ContinuityAnchor };

export const CONTINUITY_ANCHOR_COUNT = 3;

export type ContinuityDecision =
  | { action: "append"; startOffset: number }
  | { action: "rebase"; startOffset: number }
  | { action: "skip"; reason: "unproven-discontinuity" };

const ANCHOR_WINDOW_BYTES = 1024 * 1024;

export function isOffsetCursor(
  cursor: FileCursorBase | undefined,
): cursor is FileCursorBase & { offset: number } {
  return !!cursor && typeof (cursor as { offset?: unknown }).offset === "number";
}

export function usesJsonlOffsetResume(source: Source, filePath: string): boolean {
  if (source === "vscode-copilot" && filePath.endsWith(".json")) return false;
  return (
    source === "claude-code" ||
    source === "codex" ||
    source === "copilot-cli" ||
    source === "grok" ||
    source === "omp" ||
    source === "openclaw" ||
    source === "pi" ||
    source === "vscode-copilot"
  );
}

export function applyResumeStartOffset(resume: unknown, startOffset: number): void {
  if (
    resume !== null &&
    typeof resume === "object" &&
    "startOffset" in resume &&
    typeof (resume as { startOffset: unknown }).startOffset === "number"
  ) {
    (resume as { startOffset: number }).startOffset = startOffset;
  }
}

export function applyResumeEndBound(resume: unknown, endBound: number): void {
  if (resume !== null && typeof resume === "object") {
    (resume as { endBound: number }).endBound = endBound;
  }
}

/** Hash one on-disk record (bytes include the trailing line break). */
export function hashRecord(recordWithTerminator: Uint8Array): string {
  let end = recordWithTerminator.length;
  if (end > 0 && recordWithTerminator[end - 1] === 0x0a) end -= 1;
  if (end > 0 && recordWithTerminator[end - 1] === 0x0d) end -= 1;
  return createHash("sha256")
    .update(recordWithTerminator.subarray(0, end))
    .digest("hex");
}

export async function readContinuityAnchors(
  filePath: string,
  endOffset: number,
): Promise<ContinuityAnchor[] | null> {
  if (endOffset <= 0) return [];
  try {
    const handle = await open(filePath, "r");
    try {
      let window = ANCHOR_WINDOW_BYTES;
      for (;;) {
        const start = Math.max(0, endOffset - window);
        const len = endOffset - start;
        const buf = Buffer.alloc(len);
        const { bytesRead } = await handle.read(buf, 0, len, start);
        const lines = completeRecords(buf.subarray(0, bytesRead), start === 0);
        if (lines.length >= CONTINUITY_ANCHOR_COUNT || start === 0) {
          return lines.slice(-CONTINUITY_ANCHOR_COUNT);
        }
        window = Math.min(endOffset, window * 2);
      }
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function completeRecords(data: Uint8Array, fromFileStart: boolean): ContinuityAnchor[] {
  let i = 0;
  if (!fromFileStart) {
    const firstNl = data.indexOf(0x0a);
    if (firstNl === -1) return [];
    i = firstNl + 1;
  }
  const lines: ContinuityAnchor[] = [];
  let lineStart = i;
  for (; i < data.length; i++) {
    if (data[i] === 0x0a) {
      const rec = data.subarray(lineStart, i + 1);
      lines.push({ sha256: hashRecord(rec), length: rec.length });
      lineStart = i + 1;
    }
  }
  return lines;
}

export async function resolveJsonlContinuity(opts: {
  filePath: string;
  fileSize: number;
  cursorSize: number;
  offset: number;
  anchors: ContinuityAnchor[] | undefined;
}): Promise<ContinuityDecision> {
  try {
    return await resolveJsonlContinuityUnchecked(opts);
  } catch {
    return { action: "skip", reason: "unproven-discontinuity" };
  }
}

async function resolveJsonlContinuityUnchecked(opts: {
  filePath: string;
  fileSize: number;
  cursorSize: number;
  offset: number;
  anchors: ContinuityAnchor[] | undefined;
}): Promise<ContinuityDecision> {
  const { filePath, fileSize, cursorSize, offset, anchors } = opts;
  const hasAnchors = Array.isArray(anchors) && anchors.length > 0;

  if (hasAnchors) {
    if (offset <= fileSize && (await anchorsMatchAt(filePath, offset, anchors))) {
      return { action: "append", startOffset: offset };
    }
    const found = await findLastAnchorEnd(filePath, fileSize, anchors);
    if (found !== null) {
      return found === offset
        ? { action: "append", startOffset: offset }
        : { action: "rebase", startOffset: found };
    }
    return { action: "skip", reason: "unproven-discontinuity" };
  }

  if (offset === 0 && cursorSize === 0) {
    return { action: "append", startOffset: 0 };
  }
  return { action: "skip", reason: "unproven-discontinuity" };
}

async function anchorsMatchAt(
  filePath: string,
  offset: number,
  anchors: ContinuityAnchor[],
): Promise<boolean> {
  const total = anchors.reduce((sum, a) => sum + a.length, 0);
  if (offset < total) return false;
  const start = offset - total;
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(total);
    const { bytesRead } = await handle.read(buf, 0, total, start);
    if (bytesRead !== total) return false;
    let pos = 0;
    for (const anchor of anchors) {
      const slice = buf.subarray(pos, pos + anchor.length);
      if (
        slice.length !== anchor.length ||
        hashRecord(slice) !== anchor.sha256
      ) {
        return false;
      }
      pos += anchor.length;
    }
    return true;
  } finally {
    await handle.close();
  }
}

async function findLastAnchorEnd(
  filePath: string,
  fileSize: number,
  anchors: ContinuityAnchor[],
): Promise<number | null> {
  if (anchors.length === 0 || fileSize <= 0) return null;
  const stream = createReadStream(filePath, { start: 0, end: fileSize - 1 });
  let pending: Uint8Array = new Uint8Array(0);
  let absolute = 0;
  const ring: Array<{ sha256: string; length: number; end: number }> = [];
  let lastEnd: number | null = null;
  const needed = anchors.length;

  const consider = (rec: Uint8Array, endPos: number): void => {
    ring.push({ sha256: hashRecord(rec), length: rec.length, end: endPos });
    if (ring.length > needed) ring.shift();
    if (ring.length === needed) {
      let matched = true;
      for (let i = 0; i < needed; i++) {
        const entry = ring[i];
        const anchor = anchors[i];
        if (
          !entry ||
          !anchor ||
          entry.sha256 !== anchor.sha256 ||
          entry.length !== anchor.length
        ) {
          matched = false;
          break;
        }
      }
      const last = ring[needed - 1];
      if (matched && last) lastEnd = last.end;
    }
  };

  try {
    for await (const chunk of stream) {
      const piece: Uint8Array = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string);
      if (pending.length === 0) {
        pending = piece;
      } else {
        const merged = new Uint8Array(pending.length + piece.length);
        merged.set(pending, 0);
        merged.set(piece, pending.length);
        pending = merged;
      }
      let offset = 0;
      while (offset < pending.length) {
        const nl = pending.indexOf(0x0a, offset);
        if (nl === -1) break;
        const rec = pending.subarray(offset, nl + 1);
        const endPos = absolute + (nl + 1);
        consider(rec, endPos);
        offset = nl + 1;
      }
      absolute += offset;
      pending = offset === 0 ? pending : pending.subarray(offset);
    }
  } finally {
    stream.destroy();
  }
  return lastEnd;
}

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

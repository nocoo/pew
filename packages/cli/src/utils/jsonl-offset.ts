/**
 * True when the parser returned no deltas and an end offset behind the
 * orchestrator snapshot — the file shrank between continuity validation
 * and parse(), so new EOF anchors must not be installed.
 */
export function parserSawSmallerSnapshot(
  deltaCount: number,
  builtOffset: number,
  orchestratorSize: number,
): boolean {
  return deltaCount === 0 && builtOffset < orchestratorSize;
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

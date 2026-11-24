/**
 * Fast-skip change detection for file-based cursors.
 *
 * Compares inode + mtimeMs + size to detect whether a file has changed
 * since the last cursor was written. All three must match for the file
 * to be considered unchanged.
 *
 * This replaces the scattered inline checks across sync.ts and the
 * session-sync.ts `fileChanged()` helper.
 */

/** Minimal fingerprint needed for change detection */
export interface FileFingerprint {
  inode: number;
  mtimeMs: number;
  size: number;
}

/**
 * Returns true if the file has NOT changed since the cursor was written.
 *
 * A file is unchanged when all three fields match:
 * - inode (same physical file — detects rotation/replacement)
 * - mtimeMs (no writes since last scan)
 * - size (paranoia — catches in-place overwrites with same mtime)
 *
 * Returns false (= file changed) when:
 * - prev is undefined (first scan, no cursor yet)
 * - prev is missing mtimeMs/size (old cursor format, gradual migration)
 * - any of the three fields differ
 */
export function fileUnchanged(
  prev: { inode: number; mtimeMs?: number; size?: number } | undefined,
  curr: FileFingerprint,
): boolean {
  if (!prev) return false;
  // Old cursors may lack mtimeMs/size — treat as changed for gradual migration
  if (prev.mtimeMs === undefined || prev.size === undefined) return false;
  return prev.inode === curr.inode && prev.mtimeMs === curr.mtimeMs && prev.size === curr.size;
}

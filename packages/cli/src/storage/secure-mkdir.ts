/**
 * Secure directory and file helpers for sensitive pew config directories.
 *
 * Directories containing API keys, cursors, and other sensitive data should
 * use mode 0o700 (rwx------) to prevent other users from listing contents.
 * Files should use mode 0o600 (rw-------) to prevent other users from reading.
 *
 * IMPORTANT: writeFile/appendFile `mode` only applies when *creating* a file.
 * Pre-existing files retain their old permissions. Always call
 * `chmodSync(path, SECURE_FILE_MODE)` after writing to enforce 0o600.
 */
import { mkdir, chmod } from "node:fs/promises";
import { mkdirSync as mkdirSyncFs, chmodSync, statSync } from "node:fs";

/** Restrictive mode for sensitive directories (owner rwx only) */
export const SECURE_DIR_MODE = 0o700;

/** Restrictive mode for sensitive files (owner rw only) */
export const SECURE_FILE_MODE = 0o600;

/**
 * Ensure a directory exists with secure permissions, repairing if needed.
 *
 * Creates the directory with 0o700 if it doesn't exist. If it already
 * exists with looser permissions, tightens them to 0o700.
 */
export function ensureSecureDir(dir: string): void {
  mkdirSyncFs(dir, { recursive: true, mode: SECURE_DIR_MODE });
  // Repair existing directory permissions if too loose
  const stat = statSync(dir);
  if ((stat.mode & 0o777) !== SECURE_DIR_MODE) {
    chmodSync(dir, SECURE_DIR_MODE);
  }
}

/**
 * Async mkdir with secure permissions for sensitive directories.
 * Always creates with mode 0o700 regardless of umask.
 */
export async function mkdirSecure(
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  await mkdir(path, { ...options, mode: SECURE_DIR_MODE });
}

/**
 * Sync mkdir with secure permissions for sensitive directories.
 * Used in notify-handler where async is not possible.
 */
export function mkdirSecureSync(
  path: string,
  options?: { recursive?: boolean },
): void {
  mkdirSyncFs(path, { ...options, mode: SECURE_DIR_MODE });
}

/**
 * Enforce secure permissions on a file after writing.
 *
 * writeFile/appendFile `mode` only takes effect when the file is *created*.
 * If the file already existed, its permissions are unchanged. This async
 * helper unconditionally sets the file to 0o600 (owner rw only).
 */
export async function chmodSecureFile(filePath: string): Promise<void> {
  await chmod(filePath, SECURE_FILE_MODE);
}

/**
 * Synchronous variant of chmodSecureFile for contexts where async is
 * not possible (e.g. generated CJS notify handler).
 */
export function chmodSecureFileSync(filePath: string): void {
  chmodSync(filePath, SECURE_FILE_MODE);
}

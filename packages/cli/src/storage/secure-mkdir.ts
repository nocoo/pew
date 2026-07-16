/**
 * Secure directory creation helpers for sensitive pew config directories.
 *
 * Directories containing API keys, cursors, and other sensitive data should
 * use mode 0o700 (rwx------) to prevent other users from listing contents.
 *
 * Note: File permissions (0o600) are already handled by @nocoo/base-cli's
 * ConfigManager. This module ensures directory permissions are also hardened.
 */
import { mkdir } from "node:fs/promises";
import { mkdirSync as mkdirSyncFs } from "node:fs";

/** Restrictive mode for sensitive directories (owner rwx only) */
export const SECURE_DIR_MODE = 0o700;

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

/**
 * OpenCode JSON file session driver.
 *
 * Strategy: Full-scan on change (mtime only — size unreliable for dirs).
 * Discovers directories (not files) under the message dir.
 * Parser: collectOpenCodeSessions(sessionDir)
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";
import { collectOpenCodeSessions } from "../../parsers/opencode-session.js";

/** Cursor for OpenCode JSON session directories — mtime only */
export interface OpenCodeJsonSessionCursor {
  mtimeMs: number;
}

/**
 * Discover OpenCode session directories.
 *
 * Lists subdirectories under the message dir (e.g. ses_xxx/).
 * Returns absolute paths to session directories, sorted.
 */
async function discoverOpenCodeSessionDirs(messageDir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(messageDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => join(messageDir, e.name))
    .sort();
}

export const openCodeJsonSessionDriver: FileSessionDriver<OpenCodeJsonSessionCursor> = {
  kind: "file",
  source: "opencode",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.openCodeMessageDir) return [];
    return discoverOpenCodeSessionDirs(opts.openCodeMessageDir);
  },

  shouldSkip(cursor: OpenCodeJsonSessionCursor | undefined, fingerprint: FileFingerprint): boolean {
    if (!cursor) return false;
    // Directories: mtime-only comparison (size unreliable across filesystems)
    return cursor.mtimeMs === fingerprint.mtimeMs;
  },

  async parse(dirPath: string) {
    return collectOpenCodeSessions(dirPath);
  },

  buildCursor(fingerprint: FileFingerprint): OpenCodeJsonSessionCursor {
    return { mtimeMs: fingerprint.mtimeMs };
  },
};

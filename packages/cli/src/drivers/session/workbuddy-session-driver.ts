/**
 * WorkBuddy file session driver.
 *
 * Strategy: Full-scan on change (mtime + size dual-check).
 * Parser: collectWorkbuddySessions(filePath)
 */

import type { SessionFileCursor } from "@pew/core";
import { discoverWorkbuddyFilesFromRoots } from "../../discovery/sources.js";
import { collectWorkbuddySessions } from "../../parsers/workbuddy-session.js";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";

export const workbuddySessionDriver: FileSessionDriver<SessionFileCursor> = {
  kind: "file",
  source: "workbuddy",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.workbuddyDirs?.length) return [];
    return discoverWorkbuddyFilesFromRoots(opts.workbuddyDirs);
  },

  shouldSkip(
    cursor: SessionFileCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    if (!cursor) return false;
    return cursor.mtimeMs === fingerprint.mtimeMs && cursor.size === fingerprint.size;
  },

  async parse(filePath: string) {
    return collectWorkbuddySessions(filePath);
  },

  buildCursor(fingerprint: FileFingerprint): SessionFileCursor {
    return { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size };
  },
};

/**
 * Codex CLI file session driver.
 *
 * Strategy: Full-scan on change (mtime + size dual-check).
 * Parser: collectCodexSessions(filePath)
 */

import type { SessionFileCursor } from "@pew/core";
import { discoverCodexFiles } from "../../discovery/sources.js";
import { collectCodexSessions } from "../../parsers/codex-session.js";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";

export const codexSessionDriver: FileSessionDriver<SessionFileCursor> = {
  kind: "file",
  source: "codex",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.codexSessionsDir) return [];
    return discoverCodexFiles(opts.codexSessionsDir, opts.multicaCodexDirs);
  },

  shouldSkip(cursor: SessionFileCursor | undefined, fingerprint: FileFingerprint): boolean {
    if (!cursor) return false;
    return cursor.mtimeMs === fingerprint.mtimeMs && cursor.size === fingerprint.size;
  },

  async parse(filePath: string) {
    return collectCodexSessions(filePath);
  },

  buildCursor(fingerprint: FileFingerprint): SessionFileCursor {
    return { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size };
  },
};

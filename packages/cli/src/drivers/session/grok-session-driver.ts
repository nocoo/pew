/**
 * Grok CLI file session driver.
 *
 * Strategy: Full-scan on change (mtime + size dual-check) of summary.json.
 * Parser: parseGrokSession(sessionDir) — sessionDir is parent of summary.json.
 */

import { dirname } from "node:path";
import type { SessionFileCursor } from "@pew/core";
import { discoverGrokSessionDirs } from "../../discovery/sources.js";
import { parseGrokSession } from "../../parsers/grok-session.js";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";

export const grokSessionDriver: FileSessionDriver<SessionFileCursor> = {
  kind: "file",
  source: "grok",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.grokSessionsDir) return [];
    return discoverGrokSessionDirs(opts.grokSessionsDir);
  },

  shouldSkip(cursor: SessionFileCursor | undefined, fingerprint: FileFingerprint): boolean {
    if (!cursor) return false;
    return cursor.mtimeMs === fingerprint.mtimeMs && cursor.size === fingerprint.size;
  },

  async parse(filePath: string) {
    // filePath is .../summary.json; parser needs the session directory
    const sessionDir = dirname(filePath);
    const snap = await parseGrokSession(sessionDir);
    return snap ? [snap] : [];
  },

  buildCursor(fingerprint: FileFingerprint): SessionFileCursor {
    return { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size };
  },
};

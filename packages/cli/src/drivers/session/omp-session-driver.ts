/**
 * Oh My Pi file session driver.
 *
 * omp is a pi fork writing the identical session JSONL schema, so it reuses
 * the pi session collector with `source: "omp"`.
 *
 * Strategy: Full-scan on change (mtime + size dual-check).
 * Parser: collectPiSessions(filePath, "omp")
 */

import type { SessionFileCursor } from "@pew/core";
import { discoverOmpFiles } from "../../discovery/sources.js";
import { collectPiSessions } from "../../parsers/pi-session.js";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";

export const ompSessionDriver: FileSessionDriver<SessionFileCursor> = {
  kind: "file",
  source: "omp",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.ompSessionsDir) return [];
    return discoverOmpFiles(opts.ompSessionsDir);
  },

  shouldSkip(cursor: SessionFileCursor | undefined, fingerprint: FileFingerprint): boolean {
    if (!cursor) return false;
    return cursor.mtimeMs === fingerprint.mtimeMs && cursor.size === fingerprint.size;
  },

  async parse(filePath: string) {
    return collectPiSessions(filePath, "omp");
  },

  buildCursor(fingerprint: FileFingerprint): SessionFileCursor {
    return { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size };
  },
};

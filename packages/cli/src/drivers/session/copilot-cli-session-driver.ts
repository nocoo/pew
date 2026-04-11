/**
 * GitHub Copilot CLI file session driver.
 *
 * Strategy: Full-scan on change (mtime + size dual-check).
 * Parser: collectCopilotCliSessions(filePath)
 */

import type { SessionFileCursor } from "@pew/core";
import { discoverCopilotCliFiles } from "../../discovery/sources.js";
import { collectCopilotCliSessions } from "../../parsers/copilot-cli-session.js";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";

export const copilotCliSessionDriver: FileSessionDriver<SessionFileCursor> = {
  kind: "file",
  source: "copilot-cli",

  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.copilotCliLogsDir) return [];
    return discoverCopilotCliFiles(opts.copilotCliLogsDir);
  },

  shouldSkip(cursor: SessionFileCursor | undefined, fingerprint: FileFingerprint): boolean {
    if (!cursor) return false;
    return cursor.mtimeMs === fingerprint.mtimeMs && cursor.size === fingerprint.size;
  },

  async parse(filePath: string) {
    return collectCopilotCliSessions(filePath);
  },

  buildCursor(fingerprint: FileFingerprint): SessionFileCursor {
    return { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size };
  },
};

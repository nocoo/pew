import type { SessionFileCursor } from "@pew/core";
import { discoverKosmosFiles } from "../../discovery/sources.js";
import { collectKosmosSessionSnapshots } from "../../parsers/kosmos-session.js";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";

export const kosmosSessionDriver: FileSessionDriver<SessionFileCursor> = {
  kind: "file",
  source: "kosmos",
  async discover(opts: DiscoverOpts): Promise<string[]> {
    if (!opts.kosmosDataDirs || opts.kosmosDataDirs.length === 0) return [];
    return discoverKosmosFiles(opts.kosmosDataDirs);
  },
  shouldSkip(cursor: SessionFileCursor | undefined, fingerprint: FileFingerprint): boolean {
    if (!cursor) return false;
    return cursor.mtimeMs === fingerprint.mtimeMs && cursor.size === fingerprint.size;
  },
  async parse(filePath: string) { return collectKosmosSessionSnapshots({ filePath }); },
  buildCursor(fingerprint: FileFingerprint): SessionFileCursor { return { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size }; },
};

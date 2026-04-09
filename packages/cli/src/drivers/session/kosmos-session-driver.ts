import type { Source, SessionFileCursor } from "@pew/core";
import { discoverKosmosFiles } from "../../discovery/sources.js";
import { collectKosmosSessionSnapshots } from "../../parsers/kosmos-session.js";
import type { FileSessionDriver, DiscoverOpts, FileFingerprint } from "../types.js";

type KosmosDataDirKey = "kosmosDataDir" | "pmstudioDataDir";

function createKosmosLikeSessionDriver(source: Source, dirKey: KosmosDataDirKey): FileSessionDriver<SessionFileCursor> {
  return {
    kind: "file",
    source,
    async discover(opts: DiscoverOpts): Promise<string[]> {
      const dir = opts[dirKey];
      if (!dir) return [];
      return discoverKosmosFiles([dir]);
    },
    shouldSkip(cursor: SessionFileCursor | undefined, fingerprint: FileFingerprint): boolean {
      if (!cursor) return false;
      return cursor.mtimeMs === fingerprint.mtimeMs && cursor.size === fingerprint.size;
    },
    async parse(filePath: string) { return collectKosmosSessionSnapshots({ filePath, source }); },
    buildCursor(fingerprint: FileFingerprint): SessionFileCursor { return { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size }; },
  };
}

export const kosmosSessionDriver = createKosmosLikeSessionDriver("kosmos", "kosmosDataDir");
export const pmstudioSessionDriver = createKosmosLikeSessionDriver("pmstudio", "pmstudioDataDir");

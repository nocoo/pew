import type { Source, KosmosCursor } from "@pew/core";
import { discoverKosmosFiles } from "../../discovery/sources.js";
import { parseKosmosFile } from "../../parsers/kosmos.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type { FileTokenDriver, DiscoverOpts, SyncContext, FileFingerprint, ResumeState, TokenParseResult, KosmosResumeState } from "../types.js";

interface KosmosParseResult extends TokenParseResult { allMessageIds: string[]; }

type KosmosDataDirKey = "kosmosDataDir" | "pmstudioDataDir";

function createKosmosLikeTokenDriver(source: Source, dirKey: KosmosDataDirKey): FileTokenDriver<KosmosCursor> {
  return {
    kind: "file",
    source,
    async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
      const dir = opts[dirKey];
      if (!dir) return [];
      return discoverKosmosFiles([dir]);
    },
    shouldSkip(cursor: KosmosCursor | undefined, fingerprint: FileFingerprint): boolean { return fileUnchanged(cursor, fingerprint); },
    resumeState(cursor: KosmosCursor | undefined, _fingerprint: FileFingerprint): KosmosResumeState {
      const knownMessageIds = cursor?.processedMessageIds ? new Set(cursor.processedMessageIds) : null;
      return { kind: "kosmos", knownMessageIds };
    },
    async parse(filePath: string, resume: ResumeState): Promise<KosmosParseResult> {
      const r = resume as KosmosResumeState;
      const result = await parseKosmosFile({ filePath, knownMessageIds: r.knownMessageIds, source });
      return { deltas: result.deltas, allMessageIds: result.allMessageIds };
    },
    buildCursor(fingerprint: FileFingerprint, result: TokenParseResult, prev?: KosmosCursor): KosmosCursor {
      const r = result as KosmosParseResult;
      const prevIds = new Set(prev?.processedMessageIds ?? []);
      for (const id of r.allMessageIds) prevIds.add(id);
      return { inode: fingerprint.inode, mtimeMs: fingerprint.mtimeMs, size: fingerprint.size, processedMessageIds: [...prevIds], updatedAt: new Date().toISOString() };
    },
  };
}

export const kosmosTokenDriver = createKosmosLikeTokenDriver("kosmos", "kosmosDataDir");
export const pmstudioTokenDriver = createKosmosLikeTokenDriver("pmstudio", "pmstudioDataDir");

import type { KosmosCursor } from "@pew/core";
import { discoverKosmosFiles } from "../../discovery/sources.js";
import { parseKosmosFile } from "../../parsers/kosmos.js";
import { fileUnchanged } from "../../utils/file-changed.js";
import type { FileTokenDriver, DiscoverOpts, SyncContext, FileFingerprint, ResumeState, TokenParseResult, KosmosResumeState } from "../types.js";

interface KosmosParseResult extends TokenParseResult { allMessageIds: string[]; }

export const kosmosTokenDriver: FileTokenDriver<KosmosCursor> = {
  kind: "file",
  source: "kosmos",
  async discover(opts: DiscoverOpts, _ctx: SyncContext): Promise<string[]> {
    if (!opts.kosmosDataDirs || opts.kosmosDataDirs.length === 0) return [];
    return discoverKosmosFiles(opts.kosmosDataDirs);
  },
  shouldSkip(cursor: KosmosCursor | undefined, fingerprint: FileFingerprint): boolean { return fileUnchanged(cursor, fingerprint); },
  resumeState(cursor: KosmosCursor | undefined, _fingerprint: FileFingerprint): KosmosResumeState {
    const knownMessageIds = cursor?.processedMessageIds ? new Set(cursor.processedMessageIds) : null;
    return { kind: "kosmos", knownMessageIds };
  },
  async parse(filePath: string, resume: ResumeState): Promise<KosmosParseResult> {
    const r = resume as KosmosResumeState;
    const result = await parseKosmosFile({ filePath, knownMessageIds: r.knownMessageIds });
    return { deltas: result.deltas, allMessageIds: result.allMessageIds };
  },
  buildCursor(fingerprint: FileFingerprint, result: TokenParseResult, prev?: KosmosCursor): KosmosCursor {
    const r = result as KosmosParseResult;
    const prevIds = new Set(prev?.processedMessageIds ?? []);
    for (const id of r.allMessageIds) prevIds.add(id);
    return { inode: fingerprint.inode, mtimeMs: fingerprint.mtimeMs, size: fingerprint.size, processedMessageIds: [...prevIds], updatedAt: new Date().toISOString() };
  },
};

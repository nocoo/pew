import { readFile } from "node:fs/promises";
import type { EvidenceRecord } from "@pew/core";
import { BaseQueue } from "./base-queue.js";
import { evidenceKey, toEvidenceRecord } from "../utils/usage-evidence.js";

/**
 * Durable accounting evidence, also used as the absolute-snapshot outbox.
 * Reset removes parsing cursors, NEVER this ledger: rotated logs cannot
 * reconstruct previously observed call times. It contains no source bodies.
 */
export class EvidenceQueue extends BaseQueue<EvidenceRecord> {
  constructor(stateDir: string) {
    super(stateDir, "evidence-queue.jsonl", "evidence-queue.state.json");
  }

  override async readFromOffset(offset: number): Promise<{ records: EvidenceRecord[]; newOffset: number }> {
    let raw: Buffer;
    try {
      raw = await readFile(this.queuePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], newOffset: 0 };
      throw new Error("Invalid usage evidence ledger");
    }
    try {
      const records = raw.subarray(offset).toString("utf8").split("\n").filter(Boolean).map((line) => {
        const r = JSON.parse(line) as EvidenceRecord;
        if (!r.evidence || !/^[a-f0-9]{64}$/.test(r.evidence.eventId) ||
          !/^[a-f0-9]{64}$/.test(r.evidence.groupId) ||
          !Number.isSafeInteger(r.evidence.snapshotSeq) || r.evidence.snapshotSeq < 1 ||
          ![r.input_tokens, r.cached_input_tokens, r.output_tokens, r.reasoning_output_tokens, r.total_tokens]
            .every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error();
        const projected = toEvidenceRecord({ source: r.source, model: r.model, timestamp: r.timestamp,
          tokens: { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens,
            outputTokens: r.output_tokens, reasoningOutputTokens: r.reasoning_output_tokens },
          evidence: r.evidence }, r.device_id);
        // Reject unknown fields and inconsistent counters/buckets; never
        // forward a corrupted ledger's arbitrary objects to the uploader.
        if (Object.keys(r).length !== Object.keys(projected).length ||
          Object.keys(r.evidence).length !== Object.keys(projected.evidence).length ||
          r.hour_start !== projected.hour_start || r.total_tokens !== projected.total_tokens ||
          r.model !== projected.model || r.evidence.provider !== projected.evidence.provider) throw new Error();
        return projected;
      });
      return { records, newOffset: raw.byteLength };
    } catch {
      throw new Error("Invalid usage evidence ledger");
    }
  }

  /** Union by stable identity; snapshots replace, never SUM. */
  async merge(incoming: EvidenceRecord[], replay = false): Promise<void> {
    const { records } = await this.readFromOffset(0);
    const merged = new Map(records.map((r) => [evidenceKey(r), r]));
    const dirty = new Set(await this.loadDirtyKeys());
    if (replay) for (const key of merged.keys()) dirty.add(key);
    let changed = false;
    for (const r of incoming) {
      const key = evidenceKey(r);
      const prev = merged.get(key);
      if (prev) {
        if (r.evidence.snapshotSeq < prev.evidence.snapshotSeq) continue;
        if (JSON.stringify(r) === JSON.stringify(prev)) continue;
        if (r.evidence.snapshotSeq === prev.evidence.snapshotSeq ||
          r.timestamp !== prev.timestamp || r.hour_start !== prev.hour_start ||
          r.model !== prev.model || r.source !== prev.source ||
          r.evidence.groupId !== prev.evidence.groupId || r.evidence.callType !== prev.evidence.callType) {
          throw new Error("Conflicting usage evidence snapshot");
        }
      }
      merged.set(key, r);
      dirty.add(key);
      changed = true;
    }
    // Dirty keys precede the atomic ledger rename, and both precede cursor
    // commit. A crash can replay a snapshot but cannot lose its upload intent.
    if (changed || (replay && records.length > 0)) {
      await this.saveDirtyKeys([...dirty].sort());
      if (changed) await this.overwrite([...merged.values()].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b))));
    }
  }
}

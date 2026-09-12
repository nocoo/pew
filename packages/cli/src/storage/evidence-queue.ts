import { readFile } from "node:fs/promises";
import type { EvidenceRecord } from "@pew/core";
import { BaseQueue } from "./base-queue.js";
import { evidenceKey, toEvidenceRecord } from "../utils/usage-evidence.js";

function checkedRecord(r: EvidenceRecord): EvidenceRecord {
  try {
    const projected = toEvidenceRecord({ source: r.source, model: r.model, timestamp: r.timestamp,
      tokens: { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens,
        outputTokens: r.output_tokens, reasoningOutputTokens: r.reasoning_output_tokens }, evidence: r.evidence }, r.device_id);
    const sameFields = (a: object, b: object) => Object.keys(a).length === Object.keys(b).length &&
      Object.entries(b).every(([key, value]) => (a as Record<string, unknown>)[key] === value);
    const { evidence, ...fields } = r;
    const { evidence: projectedEvidence, ...projectedFields } = projected;
    if (!sameFields(fields, projectedFields) || !sameFields(evidence, projectedEvidence)) throw new Error();
    return projected;
  } catch { throw new Error("Invalid usage evidence ledger"); }
}

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
      const records = raw.subarray(offset).toString("utf8").split("\n").filter(Boolean).map((line) => checkedRecord(JSON.parse(line)));
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
    for (const raw of incoming) {
      const r = checkedRecord(raw);
      const key = evidenceKey(r);
      const prev = merged.get(key);
      if (prev) {
        if (r.evidence.snapshotSeq < prev.evidence.snapshotSeq) continue;
        if (JSON.stringify(r) === JSON.stringify(prev)) continue;
        if (r.evidence.snapshotSeq === prev.evidence.snapshotSeq ||
          r.timestamp !== prev.timestamp || r.hour_start !== prev.hour_start ||
          r.model !== prev.model || r.source !== prev.source ||
          r.evidence.groupId !== prev.evidence.groupId || r.evidence.callType !== prev.evidence.callType ||
          r.evidence.origin !== prev.evidence.origin || r.evidence.provider !== prev.evidence.provider ||
          r.evidence.granularity !== prev.evidence.granularity || r.evidence.timePrecision !== prev.evidence.timePrecision ||
          r.evidence.intervalStart !== prev.evidence.intervalStart) {
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

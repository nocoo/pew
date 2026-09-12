import { createHash } from "node:crypto";
import type { EvidenceRecord } from "@pew/core";
import type { ParsedDelta } from "../parsers/claude.js";
import { toUtcHalfHourStart } from "./buckets.js";

/** Structured encoding prevents delimiter collisions; no raw identifiers leave the parser. */
export function evidenceId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Only model/provider identifiers, never URLs, headers or arbitrary text. */
export function usageLabel(value: unknown): string {
  return typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/+:-]{0,127}$/.test(value) &&
    !/^(?:sk-|sk_|pk_|Bearer|eyJ)/i.test(value) && !value.includes("://")
    ? value : "unknown";
}

export function toEvidenceRecord(delta: ParsedDelta, deviceId: string): EvidenceRecord {
  const evidence = delta.evidence;
  const hourStart = toUtcHalfHourStart(delta.timestamp);
  if (!evidence || !hourStart) throw new Error("Invalid usage evidence");
  if (!["compaction", "background_review", "approval", "compression", "title_generation", "vision", "auxiliary"].includes(evidence.callType) ||
    !["pi-session", "hermes-review-log", "hermes-aux-ledger", "hermes-acp-ledger"].includes(evidence.origin) ||
    !["exact", "interval", "session-start", "unattributed"].includes(evidence.timePrecision) ||
    !["call", "operation", "session"].includes(evidence.granularity) ||
    ![evidence.intervalStart, evidence.intervalEnd].every((t) => t === null ||
      (typeof t === "string" && /^\d{4}-\d{2}-\d{2}T/.test(t) && Number.isFinite(Date.parse(t)))) ||
    (delta.source !== "pi" && delta.source !== "hermes") ||
    (delta.source === "pi") !== (evidence.callType === "compaction" && evidence.origin === "pi-session") ||
    (evidence.callCount !== null && (!Number.isSafeInteger(evidence.callCount) || evidence.callCount < 0))) {
    throw new Error("Invalid usage evidence");
  }
  const t = delta.tokens;
  return {
    source: delta.source, model: usageLabel(delta.model), device_id: deviceId,
    timestamp: new Date(delta.timestamp).toISOString(), hour_start: hourStart,
    input_tokens: t.inputTokens, cached_input_tokens: t.cachedInputTokens,
    output_tokens: t.outputTokens, reasoning_output_tokens: t.reasoningOutputTokens,
    total_tokens: t.inputTokens + t.cachedInputTokens + t.outputTokens + t.reasoningOutputTokens,
    evidence: {
      eventId: evidence.eventId, groupId: evidence.groupId,
      callType: evidence.callType, origin: evidence.origin,
      provider: usageLabel(evidence.provider), granularity: evidence.granularity,
      timePrecision: evidence.timePrecision, intervalStart: evidence.intervalStart,
      intervalEnd: evidence.intervalEnd, callCount: evidence.callCount,
      snapshotSeq: evidence.snapshotSeq,
    },
  };
}

export function evidenceKey(r: EvidenceRecord): string {
  return JSON.stringify([r.device_id, r.evidence.eventId]);
}

import type { EvidenceRecord } from "./types.js";
import { isValidISODate, validateIngestRecord, type ValidationResult } from "./validation.js";

const RECORD_KEYS = new Set(["source", "model", "device_id", "timestamp", "hour_start", "input_tokens",
  "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "evidence"]);
const EVIDENCE_KEYS = new Set(["eventId", "groupId", "callType", "origin", "provider", "granularity",
  "timePrecision", "intervalStart", "intervalEnd", "callCount", "snapshotSeq"]);
const CALL_TYPES = new Set(["compaction", "background_review", "approval", "compression", "title_generation", "vision", "auxiliary"]);
const ORIGINS = new Set(["pi-session", "hermes-review-log", "hermes-aux-ledger", "hermes-acp-ledger"]);
const PRECISIONS = new Set(["exact", "interval", "session-start", "unattributed"]);
const label = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/+:-]{0,127}$/.test(v) &&
  !/^(?:sk-|sk_|pk_|Bearer|eyJ)/i.test(v) && !v.includes("://");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Strict whitelist: rejection messages contain field categories, never values. */
export function validateEvidenceRecord(value: unknown, index: number): ValidationResult<EvidenceRecord> {
  const invalid = (): ValidationResult<EvidenceRecord> => ({ valid: false, error: `record[${index}]: invalid usage evidence` });
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== RECORD_KEYS.size || Object.keys(r).some((k) => !RECORD_KEYS.has(k))) return invalid();
  if (r.source !== "pi" && r.source !== "hermes") return invalid();
  if (!label(r.model) || typeof r.device_id !== "string" || !/^[\w.-]{1,128}$/.test(r.device_id)) return invalid();
  if (!validateIngestRecord(r, index).valid || !isValidISODate(r.timestamp)) return invalid();
  const time = Date.parse(r.timestamp as string);
  if (r.timestamp !== new Date(time).toISOString() ||
    r.hour_start !== new Date(Math.floor(time / 1_800_000) * 1_800_000).toISOString()) return invalid();
  const counts = [r.input_tokens, r.cached_input_tokens, r.output_tokens, r.reasoning_output_tokens];
  if (!counts.every(count) || !count(r.total_tokens) ||
    r.total_tokens !== (counts as number[]).reduce((a, b) => a + b, 0)) return invalid();
  if (!r.evidence || typeof r.evidence !== "object" || Array.isArray(r.evidence)) return invalid();
  const e = r.evidence as Record<string, unknown>;
  if (Object.keys(e).length !== EVIDENCE_KEYS.size || Object.keys(e).some((k) => !EVIDENCE_KEYS.has(k))) return invalid();
  if (!hash(e.eventId) || !hash(e.groupId) || !label(e.provider) ||
    !CALL_TYPES.has(e.callType as string) || !ORIGINS.has(e.origin as string) ||
    !PRECISIONS.has(e.timePrecision as string) || !["call", "operation", "session"].includes(e.granularity as string) ||
    !count(e.snapshotSeq) || e.snapshotSeq === 0 || (e.callCount !== null && !count(e.callCount))) return invalid();
  if ((r.source === "pi") !== (e.callType === "compaction" && e.origin === "pi-session")) return invalid();
  if (r.source === "hermes" && (e.callType === "compaction" || e.origin === "pi-session")) return invalid();
  for (const field of ["intervalStart", "intervalEnd"]) {
    if (e[field] !== null && !isValidISODate(e[field])) return invalid();
  }
  if (e.intervalStart !== null && e.intervalEnd !== null && Date.parse(e.intervalStart as string) > Date.parse(e.intervalEnd as string)) return invalid();
  return { valid: true, record: r as unknown as EvidenceRecord };
}

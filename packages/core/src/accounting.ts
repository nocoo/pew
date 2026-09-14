import type { AccountingAck, AccountingCounts, AccountingGroup, AccountingRecord, LegacyTokenCounts } from "./accounting-types.js";
import { isValidSource, type ValidationResult } from "./validation.js";

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const optionalCount = (v: unknown) => v === null || count(v);
const label = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/+:-]{0,127}$/.test(v) &&
  !/^(?:sk-|sk_|pk_|Bearer|eyJ)/i.test(v) && !v.includes("://");
const keys = (v: Record<string, unknown>, names: string) => {
  const allowed = names.split(" ");
  return Object.keys(v).length === allowed.length && Object.keys(v).every((k) => allowed.includes(k));
};
const BASIS_KEYS = "input_tokens cached_input_tokens output_tokens reasoning_output_tokens total_tokens";

function validBasis(v: unknown): v is LegacyTokenCounts {
  return object(v) && keys(v, BASIS_KEYS) && Object.values(v).every(count) &&
    v.total_tokens === Number(v.input_tokens) + Number(v.cached_input_tokens) + Number(v.output_tokens) + Number(v.reasoning_output_tokens);
}

function validCounts(v: unknown): v is AccountingCounts {
  if (!object(v) || !keys(v, "input_total_tokens cache_read_input_tokens cache_write_input_tokens cache_write_5m_input_tokens cache_write_1h_input_tokens output_total_tokens reasoning_output_tokens")) return false;
  if (!count(v.input_total_tokens) || !count(v.output_total_tokens) || !count(v.input_total_tokens + v.output_total_tokens)) return false;
  if (![v.cache_read_input_tokens, v.cache_write_input_tokens, v.cache_write_5m_input_tokens, v.cache_write_1h_input_tokens, v.reasoning_output_tokens].every(optionalCount)) return false;
  if (Number(v.cache_read_input_tokens ?? 0) + Number(v.cache_write_input_tokens ?? 0) > v.input_total_tokens) return false;
  if ((v.cache_write_5m_input_tokens !== null || v.cache_write_1h_input_tokens !== null) && v.cache_write_input_tokens === null) return false;
  if (Number(v.cache_write_5m_input_tokens ?? 0) + Number(v.cache_write_1h_input_tokens ?? 0) > Number(v.cache_write_input_tokens ?? 0)) return false;
  return Number(v.reasoning_output_tokens ?? 0) <= v.output_total_tokens;
}

function validGroup(g: unknown, source: string): g is AccountingGroup {
  if (!object(g) || !keys(g, "basis counts origin model provider route service_tier context_tokens_min context_tokens_max request_count quality reported_costs diagnostics")) return false;
  if (!validBasis(g.basis) || !label(g.origin) || !label(g.model) ||
    ![g.provider, g.route, g.service_tier].every((v) => v === null || label(v)) ||
    !["reported", "derived", "legacy", "invalid"].includes(String(g.quality))) return false;
  if (g.counts !== null) {
    if (!validCounts(g.counts) || g.counts.input_total_tokens !== g.basis.input_tokens + g.basis.cached_input_tokens) return false;
    const output = source === "hermes" ? g.basis.output_tokens : g.basis.output_tokens + g.basis.reasoning_output_tokens;
    if (g.counts.output_total_tokens !== output || g.quality === "legacy" || g.quality === "invalid") return false;
  } else if (g.quality !== "legacy" && g.quality !== "invalid") return false;
  if (![g.context_tokens_min, g.context_tokens_max, g.request_count].every(optionalCount)) return false;
  if ((g.context_tokens_min === null) !== (g.context_tokens_max === null) ||
    (g.context_tokens_min !== null && (Number(g.context_tokens_min) > Number(g.context_tokens_max) || !count(g.request_count) || g.request_count === 0))) return false;
  if (!Array.isArray(g.reported_costs) || g.reported_costs.length > 4 || !g.reported_costs.every((v: unknown) =>
    object(v) && keys(v, "units scale currency kind status source") && typeof v.units === "string" && /^(0|[1-9]\d{0,59})$/.test(v.units) &&
    count(v.scale) && v.scale <= 18 && v.currency === "USD" && label(v.source) &&
    ["actual", "estimate", "included", "unknown"].includes(String(v.kind)) && ["complete", "partial", "unknown"].includes(String(v.status)))) return false;
  if (!Array.isArray(g.diagnostics) || g.diagnostics.length > 3 || !g.diagnostics.every((v: unknown) =>
    object(v) && keys(v, "code raw_total_tokens") && ["total_mismatch", "invalid_counts", "aggregate_context"].includes(String(v.code)) && optionalCount(v.raw_total_tokens))) return false;
  return true;
}

/** Trust-boundary projection: unsupported schemas and unprojected source fields are rejected. */
export function validateAccountingRecord(value: unknown, index: number): ValidationResult<AccountingRecord> {
  const invalid = (): ValidationResult<AccountingRecord> => ({ valid: false, error: `record[${index}]: invalid accounting details` });
  if (!object(value) || !keys(value, "details_version source model device_id hour_start event_id evidence_snapshot_seq source_revision parser_revision detail_revision basis groups")) return invalid();
  if (value.details_version !== 1 || !isValidSource(value.source) || !label(value.model) ||
    typeof value.device_id !== "string" || !/^[\w.-]{1,128}$/.test(value.device_id)) return invalid();
  if (typeof value.hour_start !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:(00|30):00\.000Z$/.test(value.hour_start) ||
    !Number.isFinite(Date.parse(value.hour_start)) || new Date(value.hour_start).toISOString() !== value.hour_start) return invalid();
  if (value.event_id !== null && (typeof value.event_id !== "string" || !/^[a-f0-9]{64}$/.test(value.event_id))) return invalid();
  if (value.event_id === null ? value.evidence_snapshot_seq !== null : !count(value.evidence_snapshot_seq) || value.evidence_snapshot_seq === 0) return invalid();
  if (![value.source_revision, value.parser_revision, value.detail_revision].every((v) => count(v) && v > 0)) return invalid();
  if (!validBasis(value.basis) || !Array.isArray(value.groups) || value.groups.length === 0 || value.groups.length > 256) return invalid();
  const sum: LegacyTokenCounts = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
  const groups: AccountingGroup[] = [];
  for (const g of value.groups) {
    if (!validGroup(g, value.source)) return invalid();
    for (const k of Object.keys(sum) as Array<keyof LegacyTokenCounts>) sum[k] += g.basis[k];
    groups.push(g);
  }
  if (!Object.entries(sum).every(([k, v]) => count(v) && v === (value.basis as LegacyTokenCounts)[k as keyof LegacyTokenCounts])) return invalid();
  // Construct the envelope explicitly so its serialization is canonical.
  return { valid: true, record: {
    details_version: 1, source: value.source, model: String(value.model), device_id: value.device_id,
    hour_start: value.hour_start, event_id: value.event_id as string | null,
    evidence_snapshot_seq: value.evidence_snapshot_seq as number | null,
    source_revision: Number(value.source_revision), parser_revision: Number(value.parser_revision), detail_revision: Number(value.detail_revision),
    basis: value.basis, groups,
  } };
}

/** Only these acknowledgments may cross the web proxy; never relay arbitrary upstream bodies. */
export function accountingAcknowledgment(value: unknown, records: AccountingRecord[]): { details_version: 1; acknowledgments: AccountingAck[] } | null {
  if (!object(value) || value.details_version !== 1 || !Array.isArray(value.acknowledgments) || value.acknowledgments.length !== records.length) return null;
  const acknowledgments: AccountingAck[] = [];
  for (let i = 0; i < records.length; i++) {
    const a: unknown = value.acknowledgments[i]; const r = records[i];
    const key = JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]);
    if (!object(a) || a.key !== key || a.source_revision !== r.source_revision || a.parser_revision !== r.parser_revision ||
      a.detail_revision !== r.detail_revision || !["applied", "duplicate", "superseded", "base_mismatch", "conflict"].includes(String(a.status))) return null;
    acknowledgments.push({ key, source_revision: r.source_revision, parser_revision: r.parser_revision, detail_revision: r.detail_revision,
      status: a.status as AccountingAck["status"] });
  }
  return { details_version: 1, acknowledgments };
}

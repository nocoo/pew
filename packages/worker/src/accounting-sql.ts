import type { AccountingAck, AccountingRecord } from "@pew/core";

const ID_MATCH = "user_id = ? AND device_id = ? AND source = ? AND model = ? AND hour_start = ? AND event_id = ?";
const BASE_MATCH = `${ID_MATCH} AND input_tokens = ? AND cached_input_tokens = ? AND output_tokens = ?
  AND reasoning_output_tokens = ? AND total_tokens = ? AND evidence_snapshot_seq IS ?`;

const UPSERT = `INSERT INTO usage_details
  (user_id, device_id, source, model, hour_start, event_id, input_tokens, cached_input_tokens, output_tokens,
   reasoning_output_tokens, total_tokens, evidence_snapshot_seq, details_version, source_revision, parser_revision, detail_revision, groups_json)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE EXISTS (SELECT 1 FROM usage_bases WHERE ${BASE_MATCH})
ON CONFLICT(user_id, device_id, source, model, hour_start, event_id) DO UPDATE SET
  input_tokens = excluded.input_tokens, cached_input_tokens = excluded.cached_input_tokens,
  output_tokens = excluded.output_tokens, reasoning_output_tokens = excluded.reasoning_output_tokens,
  total_tokens = excluded.total_tokens, evidence_snapshot_seq = excluded.evidence_snapshot_seq,
  source_revision = excluded.source_revision, parser_revision = excluded.parser_revision,
  detail_revision = excluded.detail_revision, groups_json = excluded.groups_json, updated_at = datetime('now')
WHERE excluded.parser_revision >= usage_details.parser_revision AND
  (excluded.source_revision > usage_details.source_revision OR
    (excluded.source_revision = usage_details.source_revision AND excluded.detail_revision > usage_details.detail_revision
     AND excluded.input_tokens = usage_details.input_tokens AND excluded.cached_input_tokens = usage_details.cached_input_tokens
     AND excluded.output_tokens = usage_details.output_tokens AND excluded.reasoning_output_tokens = usage_details.reasoning_output_tokens
     AND excluded.total_tokens = usage_details.total_tokens AND excluded.evidence_snapshot_seq IS usage_details.evidence_snapshot_seq))
RETURNING source_revision`;

// Read every no-op inside the same native batch transaction. SQL success alone
// cannot acknowledge a conflicting, stale or mismatched annotation.
const STATE = `SELECT d.*, EXISTS(SELECT 1 FROM usage_bases WHERE ${BASE_MATCH}) AS base_matches
FROM (SELECT 1) LEFT JOIN usage_details d ON ${ID_MATCH.split(" AND ").map((s) => `d.${s}`).join(" AND ")}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function ingestAccounting(db: D1Database, userId: string, records: AccountingRecord[]): Promise<AccountingAck[]> {
  const payloads = records.map((r) => {
    const ids = [userId, r.device_id, r.source, r.model, r.hour_start, r.event_id ?? ""];
    const b = r.basis;
    const base = [...ids, b.input_tokens, b.cached_input_tokens, b.output_tokens, b.reasoning_output_tokens, b.total_tokens, r.evidence_snapshot_seq];
    return { base, ids, groups: canonical(r.groups) };
  });
  const results = await db.batch(records.flatMap((r, i) => {
    const p = payloads[i];
    return [db.prepare(UPSERT).bind(...p.base, r.details_version, r.source_revision, r.parser_revision, r.detail_revision, p.groups, ...p.base),
      db.prepare(STATE).bind(...p.base, ...p.ids)];
  }));
  return records.map((r, i) => {
    const state = results[i * 2 + 1].results[0] as Record<string, unknown>;
    let status: AccountingAck["status"];
    const storedMatches = Object.entries(r.basis).every(([k, v]) => state[k] === v) && state.evidence_snapshot_seq === r.evidence_snapshot_seq;
    if (!state.base_matches) status = "base_mismatch";
    else if (results[i * 2].results.length > 0) status = "applied";
    else if (storedMatches && state.source_revision === r.source_revision && state.parser_revision === r.parser_revision &&
      state.detail_revision === r.detail_revision && state.groups_json === payloads[i].groups) status = "duplicate";
    else if (storedMatches && (Number(state.source_revision) > r.source_revision ||
      (state.source_revision === r.source_revision && Number(state.detail_revision) > r.detail_revision) || Number(state.parser_revision) > r.parser_revision)) status = "superseded";
    else status = "conflict";
    return { key: JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]),
      source_revision: r.source_revision, parser_revision: r.parser_revision, detail_revision: r.detail_revision, status };
  });
}

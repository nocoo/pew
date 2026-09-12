import type { EvidenceRecord, TokenDelta } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import type { AuxiliaryUsageRow } from "./hermes-sqlite.js";
import { hermesSessionKey, type HermesReviewCall } from "./hermes-review.js";
import { evidenceId, usageLabel } from "../utils/usage-evidence.js";
import { addTokens, emptyTokenDelta } from "../utils/buckets.js";

const validSeconds = (t: number | null): t is number => t !== null && Number.isFinite(t) && t > 0 && Number.isFinite(new Date(t * 1000).getTime());

export function collectHermesUsageEvidence(opts: {
  dbKey: string;
  rows: AuxiliaryUsageRow[];
  calls: HermesReviewCall[];
  previous: EvidenceRecord[];
}): ParsedDelta[] {
  const output: ParsedDelta[] = [];
  const rows = opts.rows.filter((r) => r.task === "background_review");
  for (const row of rows) {
    const values = [row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens, row.reasoning_tokens, row.api_call_count];
    if (!values.every((n) => Number.isSafeInteger(n) && n >= 0)) continue;
    const groupId = evidenceId(["hermes-aux", opts.dbKey, row.session_id, row.model, row.billing_provider, row.route_key, row.task]);
    const baselineId = evidenceId([groupId, "baseline"]);
    const previous = opts.previous.filter((r) => r.evidence.groupId === groupId);
    const baseline = previous.find((r) => r.evidence.eventId === baselineId);
    const seq = validSeconds(row.last_seen) ? Math.floor(row.last_seen * 1_000_000) : 1 + values.reduce((a, b) => a + b, 0);
    if (baseline && seq <= baseline.evidence.snapshotSeq) continue;
    const current: TokenDelta = { inputTokens: row.input_tokens, cachedInputTokens: row.cache_read_tokens + row.cache_write_tokens,
      outputTokens: row.output_tokens, reasoningOutputTokens: row.reasoning_tokens };
    const prior = emptyTokenDelta();
    for (const r of previous) addTokens(prior, { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens, reasoningOutputTokens: r.reasoning_output_tokens });
    const fields = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"] as const;
    // Restored/decreasing ledgers cannot resurrect previously billed usage.
    if (fields.some((f) => current[f] < prior[f])) continue;
    let remainingCalls = row.api_call_count - previous.reduce((n, r) => n + (r.evidence.callCount ?? 0), 0);
    if (remainingCalls < 0) continue;
    const remaining = { ...current };
    for (const f of fields) remaining[f] -= prior[f];
    const model = usageLabel(row.model);
    const provider = usageLabel(row.billing_provider);
    const sessionKey = hermesSessionKey(opts.dbKey, row.session_id);
    const cutoff = baseline?.evidence.intervalEnd ? Date.parse(baseline.evidence.intervalEnd) : -Infinity;
    const ceiling = validSeconds(row.last_seen) ? row.last_seen * 1000 : -Infinity;
    const routeCount = rows.filter((r) => r.session_id === row.session_id && r.model === row.model && r.billing_provider === row.billing_provider).length;
    const exact = previous.filter((r) => r.evidence.origin === "hermes-review-log");
    const exactTotals = emptyTokenDelta();
    for (const r of exact) addTokens(exactTotals, { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens, reasoningOutputTokens: r.reasoning_output_tokens });
    let exactCount = exact.reduce((n, r) => n + (r.evidence.callCount ?? 0), 0);
    const known = new Set(previous.map((r) => r.evidence.eventId));
    if (routeCount === 1) for (const call of opts.calls) {
      const time = Date.parse(call.timestamp);
      if (call.sessionKey !== sessionKey || call.model !== model || call.provider !== provider ||
        known.has(call.eventId) || time <= cutoff || time > ceiling || remainingCalls < 1 ||
        fields.some((f) => call.tokens[f] > remaining[f])) continue;
      known.add(call.eventId);
      for (const f of fields) remaining[f] -= call.tokens[f];
      remainingCalls--;
      exactCount++;
      addTokens(exactTotals, call.tokens);
      output.push({ source: "hermes", model, timestamp: call.timestamp, tokens: call.tokens, evidence: {
        eventId: call.eventId, groupId, callType: "background_review", origin: "hermes-review-log", provider,
        granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null, callCount: 1, snapshotSeq: 1,
      } });
    }
    // Freeze already-accounted historical allocation. A newly discovered old
    // log cannot move it into different buckets on replay. The zero baseline
    // is also the durable source watermark when all usage has exact evidence.
    const timestamp = baseline?.timestamp ?? new Date((validSeconds(row.started_at) ? row.started_at : validSeconds(row.first_seen) ? row.first_seen : 0) * 1000).toISOString();
    const residual = { ...current };
    for (const f of fields) residual[f] -= exactTotals[f];
    output.push({ source: "hermes", model, timestamp, tokens: residual, evidence: {
      eventId: baselineId, groupId, callType: "background_review", origin: "hermes-aux-ledger", provider,
      granularity: "session", timePrecision: baseline?.evidence.timePrecision ?? (validSeconds(row.started_at) ? "session-start" : "unattributed"),
      intervalStart: baseline?.evidence.intervalStart ?? timestamp,
      intervalEnd: validSeconds(row.last_seen) ? new Date(row.last_seen * 1000).toISOString() : null,
      callCount: row.api_call_count - exactCount, snapshotSeq: seq,
    } });
  }
  return output;
}

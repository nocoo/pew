import type { EvidenceRecord, TokenDelta, UsageEvidence } from "@pew/core";
import type { ParsedDelta } from "./claude.js";
import type { AuxiliaryUsageRow } from "./hermes-sqlite.js";
import { hermesSessionKey, type HermesReviewCall } from "./hermes-review.js";
import { evidenceId, usageLabel } from "../utils/usage-evidence.js";
import { addTokens, emptyTokenDelta } from "../utils/buckets.js";

const validSeconds = (t: number | null): t is number => t !== null && Number.isFinite(t) && t > 0 && Number.isFinite(new Date(t * 1000).getTime());
const taskTypes = new Set(["background_review", "approval", "compression", "title_generation", "vision"]);

export function collectHermesUsageEvidence(opts: {
  dbKey: string;
  rows: AuxiliaryUsageRow[];
  calls: HermesReviewCall[];
  previous: EvidenceRecord[];
}): ParsedDelta[] {
  const output: ParsedDelta[] = [];
  const rows = opts.rows.filter((r) => typeof r.task === "string" && r.task.trim() !== "");
  for (const row of rows) {
    const values = [row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens, row.reasoning_tokens];
    if (row.api_call_count !== null) values.push(row.api_call_count);
    if (!values.every((n) => Number.isSafeInteger(n) && n >= 0)) continue;
    const groupId = evidenceId(["hermes-aux", opts.dbKey, row.session_id, row.model, row.billing_provider, row.route_key, row.task]);
    const baselineId = evidenceId([groupId, "baseline"]);
    const previous = opts.previous.filter((r) => r.evidence.groupId === groupId);
    const baseline = previous.find((r) => r.evidence.eventId === baselineId);
    // Counters provide a source revision even when a write clock stalls or
    // regresses. Neither collection time nor floating timestamp rounding can
    // make a delayed snapshot overwrite a newer cumulative value.
    const seq = 1 + values.reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(seq)) continue;
    if (baseline && seq <= baseline.evidence.snapshotSeq) continue;
    const current: TokenDelta = { inputTokens: row.input_tokens, cachedInputTokens: row.cache_read_tokens + row.cache_write_tokens,
      outputTokens: row.output_tokens, reasoningOutputTokens: row.reasoning_tokens };
    const prior = emptyTokenDelta();
    for (const r of previous) addTokens(prior, { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens, reasoningOutputTokens: r.reasoning_output_tokens });
    const fields = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"] as const;
    // Restored/decreasing ledgers cannot resurrect previously billed usage.
    if (fields.some((f) => current[f] < prior[f])) continue;
    const knownCount = row.api_call_count !== null && previous.every((r) => r.evidence.callCount !== null);
    let remainingCalls = knownCount ? (row.api_call_count as number) - previous.reduce((n, r) => n + (r.evidence.callCount ?? 0), 0) : null;
    if (remainingCalls !== null && remainingCalls < 0) continue;
    const remaining = { ...current };
    for (const f of fields) remaining[f] -= prior[f];
    const model = usageLabel(row.model);
    const provider = usageLabel(row.billing_provider);
    const callType = (taskTypes.has(row.task) ? row.task : "auxiliary") as UsageEvidence["callType"];
    const origin = baseline?.evidence.origin ?? (row.source === "acp" ? "hermes-acp-ledger" : "hermes-aux-ledger");
    const sessionKey = hermesSessionKey(opts.dbKey, row.session_id);
    const cutoff = baseline?.evidence.intervalEnd ? Date.parse(baseline.evidence.intervalEnd) : -Infinity;
    const ceiling = validSeconds(row.last_seen) ? row.last_seen * 1000 : -Infinity;
    const routeCount = rows.filter((r) => r.session_id === row.session_id && r.model === row.model && r.billing_provider === row.billing_provider && r.task === row.task).length;
    const allocated = previous.filter((r) => r.evidence.eventId !== baselineId);
    const allocatedTotals = emptyTokenDelta();
    for (const r of allocated) addTokens(allocatedTotals, { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens, reasoningOutputTokens: r.reasoning_output_tokens });
    let allocatedCount = allocated.reduce((n, r) => n + (r.evidence.callCount ?? 0), 0);
    const known = new Set(previous.map((r) => r.evidence.eventId));
    if (callType === "background_review" && routeCount === 1 && remainingCalls !== null) for (const call of opts.calls) {
      const time = Date.parse(call.timestamp);
      if (call.sessionKey !== sessionKey || call.model !== model || call.provider !== provider ||
        known.has(call.eventId) || time <= cutoff || time > ceiling || remainingCalls < 1 ||
        fields.some((f) => call.tokens[f] > remaining[f])) continue;
      known.add(call.eventId);
      for (const f of fields) remaining[f] -= call.tokens[f];
      remainingCalls--;
      allocatedCount++;
      addTokens(allocatedTotals, call.tokens);
      output.push({ source: "hermes", model, timestamp: call.timestamp, tokens: call.tokens, evidence: {
        eventId: call.eventId, groupId, callType: "background_review", origin: "hermes-review-log", provider,
        granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null, callCount: 1, snapshotSeq: 1,
      } });
    }
    // Only a previously observed ledger can bound an incremental interval.
    // These are ledger observation bounds, not invented per-call timestamps.
    // The persisted baseline makes reset/replay use the same transition IDs.
    if (baseline && Number.isFinite(cutoff) && ceiling > cutoff && fields.some((f) => remaining[f] > 0)) {
      const intervalStart = new Date(cutoff).toISOString();
      const intervalEnd = new Date(ceiling).toISOString();
      output.push({ source: "hermes", model, timestamp: intervalEnd, tokens: { ...remaining }, evidence: {
        eventId: evidenceId([groupId, "interval", baseline.evidence.snapshotSeq, seq]), groupId, callType, origin, provider,
        granularity: "session", timePrecision: "interval", intervalStart, intervalEnd,
        callCount: remainingCalls, snapshotSeq: 1,
      } });
      addTokens(allocatedTotals, remaining);
      allocatedCount += remainingCalls ?? 0;
    }
    // Freeze already-accounted historical allocation. A newly discovered old
    // log cannot move it into different buckets on replay. The zero baseline
    // is also the durable source watermark when all usage has exact evidence.
    const timestamp = baseline?.timestamp ?? new Date((validSeconds(row.started_at) ? row.started_at : validSeconds(row.first_seen) ? row.first_seen : 0) * 1000).toISOString();
    const residual = { ...current };
    for (const f of fields) residual[f] -= allocatedTotals[f];
    const intervalStart = baseline?.evidence.intervalStart ?? timestamp;
    const watermark = Math.max(cutoff, ceiling);
    output.push({ source: "hermes", model, timestamp, tokens: residual, evidence: {
      eventId: baselineId, groupId, callType, origin, provider,
      granularity: "session", timePrecision: baseline?.evidence.timePrecision ?? (validSeconds(row.started_at) ? "session-start" : "unattributed"),
      intervalStart,
      intervalEnd: Number.isFinite(watermark) && watermark >= Date.parse(intervalStart) ? new Date(watermark).toISOString() : null,
      callCount: knownCount ? (row.api_call_count as number) - allocatedCount : null, snapshotSeq: seq,
    } });
  }
  return output;
}

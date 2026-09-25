import { MAX_RECORD_TOKENS, MAX_SESSION_DURATION_SECONDS } from "../constants.js";
import { describe, expect, it } from "vitest";
import { validateIngestRecord, validateSessionIngestRecord, isNonNegativeInteger } from "../validation.js";
import { validateEvidenceRecord } from "../evidence-validation.js";
import { validateAccountingRecord } from "../accounting.js";
import { accountingFixture } from "../__test-helpers__/accounting.js";

const tokens = { source: "codex", model: "test", hour_start: "2026-09-01T00:00:00.000Z",
  input_tokens: 1_000_000_000, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1_000_000_000 };
const session = { session_key: "test", source: "codex", kind: "human", started_at: tokens.hour_start,
  last_message_at: tokens.hour_start, snapshot_at: tokens.hour_start, duration_seconds: 315_576_000,
  user_messages: 100_000_000, assistant_messages: 100_000_000, total_messages: 100_000_000, project_ref: null, model: null };
const evidence = { ...tokens, source: "pi", timestamp: tokens.hour_start, device_id: "test",
  evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "compaction", origin: "pi-session",
    provider: "test", granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null,
    callCount: 100_000_000, snapshotSeq: Number.MAX_SAFE_INTEGER } };

function details(amount: number) {
  const r = accountingFixture();
  const basis = { input_tokens: amount, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: amount };
  return { ...r, basis, groups: [{ ...r.groups[0], basis, quality: "legacy", counts: null,
    context_tokens_min: null, context_tokens_max: null, request_count: null }] };
}

describe("ingest numeric business bounds", () => {
  it("keeps billion-token buckets and long-lived high-message sessions", () => {
    expect(validateIngestRecord(tokens, 0).valid).toBe(true);
    expect(validateSessionIngestRecord(session, 0).valid).toBe(true);
    expect(validateEvidenceRecord(evidence, 0).valid).toBe(true);
    expect(validateAccountingRecord(details(1_000_000_000), 0).valid).toBe(true);
    expect(isNonNegativeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it.each([2 ** 62, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 1.5, -1])("rejects unsafe counters %s", (value) => {
    expect(isNonNegativeInteger(value)).toBe(false);
    expect(validateIngestRecord({ ...tokens, input_tokens: value }, 0).valid).toBe(false);
    expect(validateSessionIngestRecord({ ...session, duration_seconds: value }, 0).valid).toBe(false);
    expect(validateEvidenceRecord({ ...evidence, evidence: { ...evidence.evidence, callCount: value } }, 0).valid).toBe(false);
    expect(validateAccountingRecord(details(value), 0).valid).toBe(false);
  });

  it.each(["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"])("caps %s even if still a safe integer", (field) => {
    expect(validateIngestRecord({ ...tokens, [field]: 1_000_000_001 }, 0).valid).toBe(false);
    expect(validateEvidenceRecord({ ...evidence, [field]: 1_000_000_001 }, 0).valid).toBe(false);
  });

  it.each(["user_messages", "assistant_messages", "total_messages"])("caps session %s", (field) => {
    expect(validateSessionIngestRecord({ ...session, [field]: 100_000_001 }, 0).valid).toBe(false);
  });

  it("caps duration, evidence calls, and detail totals without clamping", () => {
    expect(validateSessionIngestRecord({ ...session, duration_seconds: 315_576_001 }, 0).valid).toBe(false);
    expect(validateEvidenceRecord({ ...evidence, evidence: { ...evidence.evidence, callCount: 100_000_001 } }, 0).valid).toBe(false);
    expect(validateAccountingRecord(details(1_000_000_001), 0).valid).toBe(false);
  });

  it("rejects over-limit detail metadata and independently bounds every group", () => {
    const r = accountingFixture();
    for (const patch of [{ context_tokens_min: 1_000_000_001, context_tokens_max: 1_000_000_001 },
      { request_count: 100_000_001 }, { diagnostics: [{ code: "total_mismatch", raw_total_tokens: 1_000_000_001 }] },
      { counts: { ...r.groups[0].counts, input_total_tokens: 1_000_000_001 } },
      { basis: details(1_000_000_001).basis }]) {
      expect(validateAccountingRecord({ ...r, groups: [{ ...r.groups[0], ...patch }] }, 0).valid).toBe(false);
    }
    const maximum = details(1_000_000_000);
    expect(validateAccountingRecord({ ...maximum, groups: Array(256).fill(maximum.groups[0]) }, 0).valid).toBe(false);
  });
});


it("keeps bounded nonduplicating D1 scans below int64 without claiming JS exactness", () => {
  const conservativeRowLimit = (10n * 1024n ** 3n) / 16n;
  const worstTokenSum = conservativeRowLimit * 4n * BigInt(MAX_RECORD_TOKENS);
  expect(worstTokenSum).toBeLessThan(2n ** 63n);
  expect(conservativeRowLimit * BigInt(MAX_SESSION_DURATION_SECONDS)).toBeLessThan(2n ** 63n);
  expect(worstTokenSum).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
});

import { describe, expect, it } from "vitest";
import { accountingAcknowledgment, validateAccountingRecord } from "./accounting.js";
import type { AccountingRecord } from "./accounting-types.js";

import { accountingFixture, invalidAccountingCases } from "./__test-helpers__/accounting.js";

describe("accounting annotations", () => {
  it.each(invalidAccountingCases())("rejects %s at the server boundary without exposing raw content", (_name, value) => {
    expect(validateAccountingRecord(value, 3)).toEqual({ valid: false, error: "record[3]: invalid accounting details" });
  });

  it("accepts unknown, invalid, derived, TTL and evidence classifications without changing their basis", () => {
    const r = accountingFixture();
    for (const quality of ["legacy", "invalid"]) expect(validateAccountingRecord({ ...r, groups: [{ ...r.groups[0], quality, counts: null,
      context_tokens_min: null, context_tokens_max: null, request_count: null }] }, 0).valid).toBe(true);
    const ttl = { ...r, event_id: "a".repeat(64), evidence_snapshot_seq: 1, groups: [{ ...r.groups[0], quality: "derived",
      counts: { ...r.groups[0].counts, cache_write_5m_input_tokens: 60, cache_write_1h_input_tokens: 30 },
      diagnostics: [{ code: "aggregate_context", raw_total_tokens: null }] }] };
    expect(validateAccountingRecord(ttl, 0).valid).toBe(true);
    expect(validateAccountingRecord({ ...r, source: "hermes", groups: [{ ...r.groups[0], counts: { ...r.groups[0].counts, output_total_tokens: 30 } }] }, 0).valid).toBe(true);
  });
  it("keeps legacy counters and independently classifies writes and reasoning", () => {
    const r = accountingFixture();
    expect(validateAccountingRecord(r, 0)).toEqual({ valid: true, record: r });
    expect(r.basis.total_tokens).toBe(940);
  });

  it("preserves unknown fields instead of coercing them to zero", () => {
    const r = accountingFixture();
    const group = { ...r.groups[0], counts: { ...r.groups[0].counts, cache_write_input_tokens: null } };
    const result = validateAccountingRecord({ ...r, groups: [group] }, 0);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.record.groups[0].counts?.cache_write_input_tokens).toBeNull();
  });

  it.each([
    { cache_write_input_tokens: 101 },
    { cache_write_5m_input_tokens: 80, cache_write_1h_input_tokens: 20 },
    { reasoning_output_tokens: 41 },
    { cache_read_input_tokens: -1 },
    { output_total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { cache_write_input_tokens: 1.2 },
  ])("rejects inconsistent or unsafe counts: %j", (bad) => {
    const r = accountingFixture();
    expect(validateAccountingRecord({ ...r, groups: [{ ...r.groups[0], counts: { ...r.groups[0].counts, ...bad } }] }, 0).valid).toBe(false);
  });

  it("requires mutually exclusive billing groups to cover exactly the legacy basis", () => {
    const r = accountingFixture();
    expect(validateAccountingRecord({ ...r, groups: [...r.groups, ...r.groups] }, 0).valid).toBe(false);
    expect(validateAccountingRecord({ ...r, groups: [] }, 0).valid).toBe(false);
  });

  it("keeps exact USD ticks and incomplete cost status without declaring zero free", () => {
    const r = accountingFixture();
    const reported_costs = [{ units: "85588366160000", scale: 10, currency: "USD", kind: "actual", status: "partial", source: "grok" }];
    expect(validateAccountingRecord({ ...r, groups: [{ ...r.groups[0], reported_costs }] }, 0).valid).toBe(true);
    expect(validateAccountingRecord({ ...r, groups: [{ ...r.groups[0], reported_costs: [{ ...reported_costs[0], units: 85588366160000 }] }] }, 0).valid).toBe(false);
  });

  it("rejects unsupported versions and unprojected sensitive fields", () => {
    const r = accountingFixture();
    for (const bad of [{ ...r, details_version: 2 }, { ...r, session: "private" },
      { ...r, groups: [{ ...r.groups[0], provider: "https://private.example/api" }] },
      { ...r, groups: [{ ...r.groups[0], prompt: "private" }] }]) {
      expect(validateAccountingRecord(bad, 0).valid).toBe(false);
    }
  });
});

describe("accounting acknowledgment projection", () => {
  it("requires a matching version, key, order and every revision, and strips unrelated upstream fields", () => {
    const r = accountingFixture() as AccountingRecord;
    const key = JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]);
    const ack = { key, source_revision: 1, parser_revision: 1, detail_revision: 1, status: "applied" };
    const valid = { details_version: 1, acknowledgments: [ack] };
    expect(accountingAcknowledgment({ ...valid, secret: "PRIVATE", acknowledgments: [{ ...ack, raw: "PRIVATE" }] }, [r])).toEqual(valid);
    for (const status of ["duplicate", "superseded", "base_mismatch", "conflict"]) expect(accountingAcknowledgment({ ...valid, acknowledgments: [{ ...ack, status }] }, [r])?.acknowledgments[0].status).toBe(status);
    for (const value of [null, [], {}, { ...valid, details_version: 2 }, { ...valid, acknowledgments: [] },
      ...[{ key: "wrong" }, { source_revision: 2 }, { parser_revision: 2 }, { detail_revision: 2 }, { status: "ok" }].map((patch) => ({ ...valid, acknowledgments: [{ ...ack, ...patch }] })),
      { ...valid, acknowledgments: [null] }]) expect(accountingAcknowledgment(value, [r])).toBeNull();
  });
});

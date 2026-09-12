import { describe, expect, it } from "vitest";
import { validateEvidenceRecord } from "../evidence-validation.js";
import type { EvidenceRecord } from "../types.js";

const good: EvidenceRecord = {
  source: "hermes", model: "test-model", device_id: "test-device",
  timestamp: "2026-09-06T16:00:01.000Z", hour_start: "2026-09-06T16:00:00.000Z",
  input_tokens: 100, cached_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 2, total_tokens: 132,
  evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "approval", origin: "hermes-aux-ledger",
    provider: "openai", granularity: "session", timePrecision: "session-start", intervalStart: null,
    intervalEnd: "2026-09-07T16:00:00.000Z", callCount: 3, snapshotSeq: 2 },
};

describe("usage evidence trust boundary", () => {
  it("accepts projected evidence and allows null call counts without inventing requests", () => {
    expect(validateEvidenceRecord(good, 0)).toEqual({ valid: true, record: good });
    expect(validateEvidenceRecord({ ...good, evidence: { ...good.evidence, callCount: null } }, 0).valid).toBe(true);
  });

  it.each([
    null, [], 1,
    { ...good, prompt: "PRIVATE_FIXTURE_BODY" },
    { ...good, source: "PRIVATE_FIXTURE_BODY" },
    { ...good, model: "Bearer PRIVATE_FIXTURE_BODY" },
    { ...good, device_id: "cookie=PRIVATE_FIXTURE_BODY" },
    { ...good, timestamp: "2026-09-06 16:00:01" },
    { ...good, hour_start: "2026-09-06T17:00:00.000Z" },
    { ...good, input_tokens: -1 },
    { ...good, total_tokens: 131 },
    { ...good, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...good, evidence: null },
    { ...good, evidence: [] },
    ...[
      { eventId: "raw-session-id" }, { groupId: "raw-profile" }, { provider: "https://private.invalid" },
      { provider: "sk-synthetic" }, { callType: "PRIVATE_FIXTURE_BODY" }, { origin: "PRIVATE_FIXTURE_BODY" },
      { granularity: "PRIVATE_FIXTURE_BODY" }, { timePrecision: "PRIVATE_FIXTURE_BODY" },
      { callCount: -1 }, { snapshotSeq: 0 }, { snapshotSeq: 1.1 },
      { intervalStart: "PRIVATE_FIXTURE_BODY" }, { intervalEnd: "PRIVATE_FIXTURE_BODY" },
      { intervalStart: "2026-09-08T00:00:00.000Z" }, { response: "PRIVATE_FIXTURE_BODY" },
      { callType: "compaction" }, { origin: "pi-session" },
    ].map((evidence) => ({ ...good, evidence: { ...good.evidence, ...evidence } })),
  ])("rejects untrusted shape, numbers or provenance without echoing input (#%#)", (value) => {
    const result = validateEvidenceRecord(value, 4);
    expect(result).toEqual({ valid: false, error: "record[4]: invalid usage evidence" });
  });
});

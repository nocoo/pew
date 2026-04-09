/**
 * Tests for @pew/core validation functions.
 *
 * Covers primitive validators, ingest record validation,
 * and session record validation with edge cases.
 */
import { describe, expect, it } from "vitest";
import { MAX_STRING_LENGTH } from "../constants.js";
import {
  isNonEmptyString,
  isNonNegativeFinite,
  isNonNegativeInteger,
  isNullableString,
  isValidISODate,
  isValidMonth,
  isValidSessionKind,
  isValidSource,
  validateBudgetInput,
  validateIngestRecord,
  validateSessionIngestRecord,
} from "../validation.js";

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

describe("isValidSource", () => {
  it("should accept all 10 sources", () => {
    expect(isValidSource("claude-code")).toBe(true);
    expect(isValidSource("codex")).toBe(true);
    expect(isValidSource("copilot-cli")).toBe(true);
    expect(isValidSource("gemini-cli")).toBe(true);
    expect(isValidSource("hermes")).toBe(true);
    expect(isValidSource("kosmos")).toBe(true);
    expect(isValidSource("opencode")).toBe(true);
    expect(isValidSource("openclaw")).toBe(true);
    expect(isValidSource("pi")).toBe(true);
    expect(isValidSource("vscode-copilot")).toBe(true);
  });

  it("should reject invalid sources", () => {
    expect(isValidSource("cursor")).toBe(false);
    expect(isValidSource("")).toBe(false);
    expect(isValidSource(null)).toBe(false);
    expect(isValidSource(undefined)).toBe(false);
    expect(isValidSource(42)).toBe(false);
  });
});

describe("isValidSessionKind", () => {
  it("should accept human and automated", () => {
    expect(isValidSessionKind("human")).toBe(true);
    expect(isValidSessionKind("automated")).toBe(true);
  });

  it("should reject invalid kinds", () => {
    expect(isValidSessionKind("bot")).toBe(false);
    expect(isValidSessionKind("")).toBe(false);
    expect(isValidSessionKind(null)).toBe(false);
    expect(isValidSessionKind(123)).toBe(false);
  });
});

describe("isValidISODate", () => {
  it("should accept valid ISO 8601 dates", () => {
    expect(isValidISODate("2026-03-07T10:30:00Z")).toBe(true);
    expect(isValidISODate("2026-03-07T10:30:00.000Z")).toBe(true);
    expect(isValidISODate("2026-01-15T00:00:00Z")).toBe(true);
    expect(isValidISODate("2026-12-31T23:59:59Z")).toBe(true);
    expect(isValidISODate("2026-03-07T10:30:00+08:00")).toBe(true);
    expect(isValidISODate("2026-03-07T10:30:00-05:00")).toBe(true);
    expect(isValidISODate("2026-03-07T10:30:00.123456Z")).toBe(true);
  });

  it("should reject dates without timezone (old-style format)", () => {
    // The old regex accepted these; our stricter version requires timezone
    expect(isValidISODate("2026-03-07T10:30:00")).toBe(false);
    expect(isValidISODate("2026-03-07T10:30:00.000")).toBe(false);
  });

  it("should reject semantic nonsense", () => {
    expect(isValidISODate("9999-99-99T99:99:99Z")).toBe(false);
    expect(isValidISODate("2026-13-01T00:00:00Z")).toBe(false);
    expect(isValidISODate("2026-00-01T00:00:00Z")).toBe(false);
    expect(isValidISODate("2026-01-32T00:00:00Z")).toBe(false);
    expect(isValidISODate("2026-01-01T25:00:00Z")).toBe(false);
    expect(isValidISODate("2026-01-01T00:60:00Z")).toBe(false);
  });

  it("should reject trailing garbage", () => {
    expect(isValidISODate("2026-03-07T10:30:00Z DROP TABLE")).toBe(false);
    expect(isValidISODate("2026-03-07T10:30:00Z; --")).toBe(false);
  });

  it("should reject non-string inputs", () => {
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(undefined)).toBe(false);
    expect(isValidISODate(42)).toBe(false);
    expect(isValidISODate({})).toBe(false);
  });

  it("should reject empty and partial strings", () => {
    expect(isValidISODate("")).toBe(false);
    expect(isValidISODate("2026")).toBe(false);
    expect(isValidISODate("2026-03-07")).toBe(false);
    expect(isValidISODate("not-a-date")).toBe(false);
  });
});

describe("isNonNegativeInteger", () => {
  it("should accept non-negative integers", () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(1)).toBe(true);
    expect(isNonNegativeInteger(999999)).toBe(true);
  });

  it("should reject negative integers", () => {
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(-100)).toBe(false);
  });

  it("should reject floats (fixes original bug)", () => {
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger(0.1)).toBe(false);
  });

  it("should reject special values", () => {
    expect(isNonNegativeInteger(Infinity)).toBe(false);
    expect(isNonNegativeInteger(-Infinity)).toBe(false);
    expect(isNonNegativeInteger(NaN)).toBe(false);
  });

  it("should reject non-number types", () => {
    expect(isNonNegativeInteger("42")).toBe(false);
    expect(isNonNegativeInteger(null)).toBe(false);
    expect(isNonNegativeInteger(undefined)).toBe(false);
  });
});

describe("isNonNegativeFinite", () => {
  it("should accept non-negative finite numbers", () => {
    expect(isNonNegativeFinite(0)).toBe(true);
    expect(isNonNegativeFinite(1.5)).toBe(true);
    expect(isNonNegativeFinite(42)).toBe(true);
  });

  it("should reject negative and special values", () => {
    expect(isNonNegativeFinite(-1)).toBe(false);
    expect(isNonNegativeFinite(Infinity)).toBe(false);
    expect(isNonNegativeFinite(NaN)).toBe(false);
  });

  it("should reject non-number types", () => {
    expect(isNonNegativeFinite("1.5")).toBe(false);
    expect(isNonNegativeFinite(null)).toBe(false);
  });
});

describe("isNonEmptyString", () => {
  it("should accept normal strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString("a")).toBe(true);
  });

  it("should reject empty strings", () => {
    expect(isNonEmptyString("")).toBe(false);
  });

  it("should enforce max length", () => {
    const longString = "x".repeat(MAX_STRING_LENGTH);
    expect(isNonEmptyString(longString)).toBe(true);
    expect(isNonEmptyString(longString + "x")).toBe(false);
  });

  it("should accept custom max length", () => {
    expect(isNonEmptyString("abc", 3)).toBe(true);
    expect(isNonEmptyString("abcd", 3)).toBe(false);
  });

  it("should reject non-string types", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
  });
});

describe("isNullableString", () => {
  it("should accept null", () => {
    expect(isNullableString(null)).toBe(true);
  });

  it("should accept strings within limit", () => {
    expect(isNullableString("hello")).toBe(true);
    expect(isNullableString("")).toBe(true);
  });

  it("should reject strings over limit", () => {
    expect(isNullableString("x".repeat(MAX_STRING_LENGTH + 1))).toBe(false);
  });

  it("should accept custom max length", () => {
    expect(isNullableString("abc", 3)).toBe(true);
    expect(isNullableString("abcd", 3)).toBe(false);
  });

  it("should reject non-string/non-null", () => {
    expect(isNullableString(undefined)).toBe(false);
    expect(isNullableString(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ingest record validation
// ---------------------------------------------------------------------------

function validTokenRecord() {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-07T10:30:00.000Z",
    input_tokens: 5000,
    cached_input_tokens: 1000,
    output_tokens: 2000,
    reasoning_output_tokens: 0,
    total_tokens: 8000,
  };
}

describe("validateIngestRecord", () => {
  it("should accept a valid record", () => {
    const result = validateIngestRecord(validTokenRecord(), 0);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.source).toBe("claude-code");
      expect(result.record.total_tokens).toBe(8000);
    }
  });

  it("should accept all 10 sources", () => {
    for (const source of ["claude-code", "codex", "copilot-cli", "gemini-cli", "hermes", "kosmos", "opencode", "openclaw", "pi", "vscode-copilot"]) {
      const rec = { ...validTokenRecord(), source };
      expect(validateIngestRecord(rec, 0).valid).toBe(true);
    }
  });

  it("should reject non-object inputs", () => {
    expect(validateIngestRecord(null, 0).valid).toBe(false);
    expect(validateIngestRecord("string", 0).valid).toBe(false);
    expect(validateIngestRecord(42, 0).valid).toBe(false);
    expect(validateIngestRecord(undefined, 0).valid).toBe(false);
  });

  it("should reject invalid source", () => {
    const rec = { ...validTokenRecord(), source: "cursor" };
    const result = validateIngestRecord(rec, 3);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("record[3]");
      expect(result.error).toContain("source");
    }
  });

  it("should reject empty model", () => {
    const rec = { ...validTokenRecord(), model: "" };
    expect(validateIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should reject overly long model string (fixes original bug)", () => {
    const rec = { ...validTokenRecord(), model: "x".repeat(MAX_STRING_LENGTH + 1) };
    expect(validateIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should reject invalid hour_start format", () => {
    const cases = [
      "not-a-date",
      "2026-03-07", // no time
      "2026-03-07T10:30:00", // no timezone
      "9999-99-99T99:99:99Z",
    ];
    for (const hour_start of cases) {
      const rec = { ...validTokenRecord(), hour_start };
      expect(validateIngestRecord(rec, 0).valid).toBe(false);
    }
  });

  it("should reject float token values (fixes original bug)", () => {
    const rec = { ...validTokenRecord(), input_tokens: 1.5 };
    const result = validateIngestRecord(rec, 0);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("non-negative integer");
    }
  });

  it("should reject negative token values", () => {
    const rec = { ...validTokenRecord(), output_tokens: -1 };
    expect(validateIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should reject Infinity/NaN token values", () => {
    expect(validateIngestRecord({ ...validTokenRecord(), total_tokens: Infinity }, 0).valid).toBe(false);
    expect(validateIngestRecord({ ...validTokenRecord(), total_tokens: NaN }, 0).valid).toBe(false);
  });

  it("should include correct index in error messages", () => {
    const result = validateIngestRecord(null, 7);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("record[7]");
    }
  });

  it("should reject records with missing token fields", () => {
    const rec = { ...validTokenRecord() };
    delete (rec as Record<string, unknown>).total_tokens;
    expect(validateIngestRecord(rec, 0).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session record validation
// ---------------------------------------------------------------------------

function validSessionRecord() {
  return {
    session_key: "claude:ses-001",
    source: "claude-code",
    kind: "human",
    started_at: "2026-03-07T10:00:00Z",
    last_message_at: "2026-03-07T11:30:00Z",
    duration_seconds: 5400,
    user_messages: 10,
    assistant_messages: 10,
    total_messages: 20,
    project_ref: "abc123",
    model: "claude-sonnet-4-20250514",
    snapshot_at: "2026-03-09T06:00:00Z",
  };
}

describe("validateSessionIngestRecord", () => {
  it("should accept a valid session record", () => {
    const result = validateSessionIngestRecord(validSessionRecord(), 0);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.session_key).toBe("claude:ses-001");
    }
  });

  it("should accept null project_ref and model", () => {
    const rec = { ...validSessionRecord(), project_ref: null, model: null };
    expect(validateSessionIngestRecord(rec, 0).valid).toBe(true);
  });

  it("should reject non-object inputs", () => {
    expect(validateSessionIngestRecord(null, 0).valid).toBe(false);
    expect(validateSessionIngestRecord("string", 0).valid).toBe(false);
    expect(validateSessionIngestRecord(42, 0).valid).toBe(false);
  });

  it("should reject empty session_key", () => {
    const rec = { ...validSessionRecord(), session_key: "" };
    expect(validateSessionIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should reject invalid source", () => {
    const rec = { ...validSessionRecord(), source: "cursor" };
    const result = validateSessionIngestRecord(rec, 2);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("record[2]");
      expect(result.error).toContain("source");
    }
  });

  it("should reject invalid kind", () => {
    const rec = { ...validSessionRecord(), kind: "bot" };
    expect(validateSessionIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should reject invalid date formats", () => {
    expect(
      validateSessionIngestRecord({ ...validSessionRecord(), started_at: "not-a-date" }, 0).valid,
    ).toBe(false);
    expect(
      validateSessionIngestRecord({ ...validSessionRecord(), last_message_at: "2026-03-07" }, 0).valid,
    ).toBe(false);
    expect(
      validateSessionIngestRecord({ ...validSessionRecord(), snapshot_at: "" }, 0).valid,
    ).toBe(false);
  });

  it("should reject float integer fields (fixes original bug)", () => {
    const rec = { ...validSessionRecord(), user_messages: 1.5 };
    expect(validateSessionIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should reject negative integer fields", () => {
    const rec = { ...validSessionRecord(), duration_seconds: -1 };
    expect(validateSessionIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should reject non-string/non-null for nullable fields", () => {
    expect(
      validateSessionIngestRecord({ ...validSessionRecord(), project_ref: 42 }, 0).valid,
    ).toBe(false);
    expect(
      validateSessionIngestRecord({ ...validSessionRecord(), model: 42 }, 0).valid,
    ).toBe(false);
  });

  it("should reject overly long nullable strings", () => {
    const rec = { ...validSessionRecord(), project_ref: "x".repeat(MAX_STRING_LENGTH + 1) };
    expect(validateSessionIngestRecord(rec, 0).valid).toBe(false);
  });

  it("should include correct index in error messages", () => {
    const result = validateSessionIngestRecord(null, 5);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("record[5]");
    }
  });

  it("should reject records with missing fields", () => {
    const rec = { ...validSessionRecord() };
    delete (rec as Record<string, unknown>).total_messages;
    expect(validateSessionIngestRecord(rec, 0).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Budget validation
// ---------------------------------------------------------------------------

describe("isValidMonth", () => {
  it("should accept valid YYYY-MM strings", () => {
    expect(isValidMonth("2026-01")).toBe(true);
    expect(isValidMonth("2026-03")).toBe(true);
    expect(isValidMonth("2026-12")).toBe(true);
    expect(isValidMonth("2025-06")).toBe(true);
  });

  it("should reject invalid month values", () => {
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-99")).toBe(false);
  });

  it("should reject malformed strings", () => {
    expect(isValidMonth("March 2026")).toBe(false);
    expect(isValidMonth("2026")).toBe(false);
    expect(isValidMonth("2026-3")).toBe(false);
    expect(isValidMonth("26-03")).toBe(false);
    expect(isValidMonth("")).toBe(false);
    expect(isValidMonth("2026-03-01")).toBe(false); // full date, not month
  });

  it("should reject non-string inputs", () => {
    expect(isValidMonth(null)).toBe(false);
    expect(isValidMonth(undefined)).toBe(false);
    expect(isValidMonth(202603)).toBe(false);
  });
});

describe("validateBudgetInput", () => {
  it("should accept a valid budget with both fields", () => {
    const result = validateBudgetInput({
      month: "2026-03",
      budget_usd: 100,
      budget_tokens: 5_000_000,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record).toEqual({
        month: "2026-03",
        budget_usd: 100,
        budget_tokens: 5_000_000,
      });
    }
  });

  it("should accept zero budgets", () => {
    const result = validateBudgetInput({
      month: "2026-03",
      budget_usd: 0,
      budget_tokens: 0,
    });
    expect(result.valid).toBe(true);
  });

  it("should accept budget_usd only", () => {
    const result = validateBudgetInput({
      month: "2026-03",
      budget_usd: 50.5,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.budget_usd).toBe(50.5);
      expect(result.record.budget_tokens).toBeNull();
    }
  });

  it("should accept budget_tokens only", () => {
    const result = validateBudgetInput({
      month: "2026-03",
      budget_tokens: 1_000_000,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.budget_usd).toBeNull();
      expect(result.record.budget_tokens).toBe(1_000_000);
    }
  });

  it("should reject invalid month format", () => {
    const result = validateBudgetInput({
      month: "March 2026",
      budget_usd: 100,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("month");
    }
  });

  it("should reject missing month", () => {
    const result = validateBudgetInput({ budget_usd: 100 });
    expect(result.valid).toBe(false);
  });

  it("should reject negative budget_usd", () => {
    const result = validateBudgetInput({
      month: "2026-03",
      budget_usd: -50,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("budget_usd");
    }
  });

  it("should reject negative budget_tokens", () => {
    const result = validateBudgetInput({
      month: "2026-03",
      budget_tokens: -1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("budget_tokens");
    }
  });

  it("should reject Infinity/NaN budget values", () => {
    expect(
      validateBudgetInput({ month: "2026-03", budget_usd: Infinity }).valid,
    ).toBe(false);
    expect(
      validateBudgetInput({ month: "2026-03", budget_usd: NaN }).valid,
    ).toBe(false);
  });

  it("should reject when neither budget field is provided", () => {
    const result = validateBudgetInput({ month: "2026-03" });
    expect(result.valid).toBe(false);
  });

  it("should reject non-object inputs", () => {
    expect(validateBudgetInput(null).valid).toBe(false);
    expect(validateBudgetInput("string").valid).toBe(false);
    expect(validateBudgetInput(42).valid).toBe(false);
  });
});

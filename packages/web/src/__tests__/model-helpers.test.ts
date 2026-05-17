import { describe, it, expect } from "vitest";
import { shortModel, toModelEvolutionPoints } from "@/lib/model-helpers";
import type { UsageRow } from "@/hooks/use-usage-data";

describe("shortModel", () => {
  it("strips 'models/' prefix from Gemini-style model IDs", () => {
    expect(shortModel("models/gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });

  it("strips date suffix (-YYYYMMDD)", () => {
    expect(shortModel("claude-sonnet-4-20250514")).toBe("claude-sonnet-4");
  });

  it("strips both prefix and date suffix", () => {
    expect(shortModel("models/gemini-2.5-pro-20260101")).toBe("gemini-2.5-pro");
  });

  it("truncates names longer than 24 chars with ellipsis", () => {
    const longName = "a-very-long-model-name-that-exceeds-limit";
    const result = shortModel(longName);
    expect(result.length).toBe(25); // 22 chars + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("does not truncate names exactly 24 chars", () => {
    const exact24 = "abcdefghijklmnopqrstuvwx"; // 24 chars
    expect(shortModel(exact24)).toBe(exact24);
  });

  it("does not truncate short names", () => {
    expect(shortModel("gpt-4o")).toBe("gpt-4o");
  });

  it("handles empty string", () => {
    expect(shortModel("")).toBe("");
  });

  it("does not strip partial date-like suffixes", () => {
    // "-12345678" has 8 digits but regex is /-\d{8}$/ so this would match
    // But "-1234567" (7 digits) should not
    expect(shortModel("model-1234567")).toBe("model-1234567");
  });

  it("only strips trailing date suffix, not mid-string", () => {
    // The regex uses $ anchor, so only trailing match
    expect(shortModel("claude-20250514-sonnet")).toBe("claude-20250514-sonnet");
  });
});

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-07",
    input_tokens: 1000,
    cached_input_tokens: 200,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 1700,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toModelEvolutionPoints
// ---------------------------------------------------------------------------

describe("toModelEvolutionPoints", () => {
  it("should return empty array for empty input", () => {
    expect(toModelEvolutionPoints([])).toEqual([]);
  });

  it("should group by date and model", () => {
    const rows = [
      makeRow({ model: "claude-sonnet-4-20250514", hour_start: "2026-03-07T10:00:00Z", total_tokens: 3000 }),
      makeRow({ model: "gemini-2.5-pro", hour_start: "2026-03-07T14:00:00Z", total_tokens: 2000 }),
      makeRow({ model: "claude-sonnet-4-20250514", hour_start: "2026-03-08T09:00:00Z", total_tokens: 4000 }),
    ];
    const result = toModelEvolutionPoints(rows);
    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.models["claude-sonnet-4-20250514"]).toBe(3000);
    expect(result[0]!.models["gemini-2.5-pro"]).toBe(2000);
    expect(result[1]!.date).toBe("2026-03-08");
    expect(result[1]!.models["claude-sonnet-4-20250514"]).toBe(4000);
    // gemini should be zero-filled
    expect(result[1]!.models["gemini-2.5-pro"]).toBe(0);
  });

  it("should group models beyond topN as 'Other'", () => {
    const rows = [
      makeRow({ model: "model-a", hour_start: "2026-03-07", total_tokens: 5000 }),
      makeRow({ model: "model-b", hour_start: "2026-03-07", total_tokens: 4000 }),
      makeRow({ model: "model-c", hour_start: "2026-03-07", total_tokens: 3000 }),
      makeRow({ model: "model-d", hour_start: "2026-03-07", total_tokens: 100 }),
    ];
    const result = toModelEvolutionPoints(rows, 3);
    expect(result).toHaveLength(1);
    // Top 3: model-a, model-b, model-c; model-d grouped as "Other"
    expect(result[0]!.models["model-a"]).toBe(5000);
    expect(result[0]!.models["model-b"]).toBe(4000);
    expect(result[0]!.models["model-c"]).toBe(3000);
    expect(result[0]!.models["Other"]).toBe(100);
    expect(result[0]!.models["model-d"]).toBeUndefined();
  });

  it("drops models beyond topN when includeOther is false", () => {
    const rows = [
      makeRow({ model: "model-a", hour_start: "2026-03-07", total_tokens: 5000 }),
      makeRow({ model: "model-b", hour_start: "2026-03-07", total_tokens: 100 }),
    ];
    const result = toModelEvolutionPoints(rows, 1, 0, false);
    expect(result).toHaveLength(1);
    expect(result[0]!.models["model-a"]).toBe(5000);
    // model-b is below topN and includeOther=false → dropped, no "Other" key.
    expect(result[0]!.models["Other"]).toBeUndefined();
    expect(result[0]!.models["model-b"]).toBeUndefined();
  });

  it("should default topN to 5", () => {
    const rows = [
      makeRow({ model: "m1", hour_start: "2026-03-07", total_tokens: 6000 }),
      makeRow({ model: "m2", hour_start: "2026-03-07", total_tokens: 5000 }),
      makeRow({ model: "m3", hour_start: "2026-03-07", total_tokens: 4000 }),
      makeRow({ model: "m4", hour_start: "2026-03-07", total_tokens: 3000 }),
      makeRow({ model: "m5", hour_start: "2026-03-07", total_tokens: 2000 }),
      makeRow({ model: "m6", hour_start: "2026-03-07", total_tokens: 1000 }),
      makeRow({ model: "m7", hour_start: "2026-03-07", total_tokens: 500 }),
    ];
    const result = toModelEvolutionPoints(rows);
    expect(result).toHaveLength(1);
    const modelKeys = Object.keys(result[0]!.models);
    // 5 top models + "Other"
    expect(modelKeys).toHaveLength(6);
    expect(result[0]!.models["Other"]).toBe(1500); // m6(1000) + m7(500)
  });

  it("should not include 'Other' when all models fit in topN", () => {
    const rows = [
      makeRow({ model: "model-a", hour_start: "2026-03-07", total_tokens: 3000 }),
      makeRow({ model: "model-b", hour_start: "2026-03-07", total_tokens: 2000 }),
    ];
    const result = toModelEvolutionPoints(rows, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.models["Other"]).toBeUndefined();
    expect(Object.keys(result[0]!.models)).toHaveLength(2);
  });

  it("should sort by date ascending", () => {
    const rows = [
      makeRow({ model: "claude-sonnet-4-20250514", hour_start: "2026-03-09", total_tokens: 1000 }),
      makeRow({ model: "claude-sonnet-4-20250514", hour_start: "2026-03-07", total_tokens: 2000 }),
    ];
    const result = toModelEvolutionPoints(rows);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[1]!.date).toBe("2026-03-09");
  });

  it("should shift records across midnight with positive tzOffset (UTC-8)", () => {
    // 2026-03-08T03:00Z → 2026-03-07T19:00 PST → local date 2026-03-07
    const rows = [
      makeRow({ model: "claude-sonnet-4-20250514", hour_start: "2026-03-07T20:00:00Z", total_tokens: 3000 }),
      makeRow({ model: "claude-sonnet-4-20250514", hour_start: "2026-03-08T03:00:00Z", total_tokens: 2000 }),
    ];
    const result = toModelEvolutionPoints(rows, 5, 480); // UTC-8

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.models["claude-sonnet-4-20250514"]).toBe(5000);
  });

  it("should shift records across midnight with negative tzOffset (UTC+9)", () => {
    // 2026-03-07T20:00Z → 2026-03-08T05:00 JST → local date 2026-03-08
    const rows = [
      makeRow({ model: "claude-sonnet-4-20250514", hour_start: "2026-03-07T10:00:00Z", total_tokens: 1000 }),
      makeRow({ model: "gemini-2.5-pro", hour_start: "2026-03-07T20:00:00Z", total_tokens: 2000 }),
    ];
    const result = toModelEvolutionPoints(rows, 5, -540); // UTC+9

    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-03-07");
    expect(result[0]!.models["claude-sonnet-4-20250514"]).toBe(1000);
    expect(result[1]!.date).toBe("2026-03-08");
    expect(result[1]!.models["gemini-2.5-pro"]).toBe(2000);
  });
});

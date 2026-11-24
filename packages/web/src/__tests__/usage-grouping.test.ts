import { describe, it, expect } from "vitest";
import {
  groupByModel,
  groupByAgent,
  groupByDate,
  extractSources,
  extractModels,
} from "@/lib/usage-helpers";
import type { UsageRow } from "@/hooks/use-usage-data";
import { getDefaultPricingMap } from "@/lib/pricing";
import type { PricingMap } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pm(): PricingMap {
  return getDefaultPricingMap();
}

function makeRow(partial: Partial<UsageRow> = {}): UsageRow {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-10T14:00:00Z",
    input_tokens: 100_000,
    cached_input_tokens: 10_000,
    output_tokens: 50_000,
    reasoning_output_tokens: 0,
    total_tokens: 150_000,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// groupByModel
// ---------------------------------------------------------------------------

describe("groupByModel", () => {
  it("returns empty array for no records", () => {
    expect(groupByModel([], pm())).toEqual([]);
  });

  it("groups records by model with correct aggregates", () => {
    const rows = [
      makeRow({
        model: "claude-sonnet-4-20250514",
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 10,
        total_tokens: 150,
      }),
      makeRow({
        model: "claude-sonnet-4-20250514",
        input_tokens: 200,
        output_tokens: 100,
        cached_input_tokens: 20,
        total_tokens: 300,
      }),
      makeRow({
        model: "gpt-4o",
        source: "opencode",
        input_tokens: 500,
        output_tokens: 200,
        cached_input_tokens: 0,
        total_tokens: 700,
      }),
    ];

    const result = groupByModel(rows, pm());

    expect(result).toHaveLength(2);
    // Sorted by totalTokens descending → gpt-4o (700) first
    expect(result[0]!.model).toBe("gpt-4o");
    expect(result[0]!.totalTokens).toBe(700);
    expect(result[1]!.model).toBe("claude-sonnet-4-20250514");
    expect(result[1]!.totalTokens).toBe(450);
    expect(result[1]!.inputTokens).toBe(300);
    expect(result[1]!.outputTokens).toBe(150);
    expect(result[1]!.cachedTokens).toBe(30);
  });

  it("tracks multiple sources per model", () => {
    const rows = [
      makeRow({ model: "gpt-4o", source: "opencode" }),
      makeRow({ model: "gpt-4o", source: "openclaw" }),
    ];
    const result = groupByModel(rows, pm());
    expect(result[0]!.sources).toHaveLength(2);
    expect(result[0]!.sources).toContain("opencode");
    expect(result[0]!.sources).toContain("openclaw");
  });

  it("computes pctOfTotal correctly", () => {
    const rows = [
      makeRow({ model: "a", total_tokens: 750 }),
      makeRow({ model: "b", total_tokens: 250 }),
    ];
    const result = groupByModel(rows, pm());
    const modelA = result.find((r) => r.model === "a")!;
    const modelB = result.find((r) => r.model === "b")!;
    expect(modelA.pctOfTotal).toBeCloseTo(75, 0);
    expect(modelB.pctOfTotal).toBeCloseTo(25, 0);
  });

  it("returns 0% when grandTotal is 0", () => {
    const rows = [makeRow({ model: "x", total_tokens: 0 })];
    const result = groupByModel(rows, pm());
    expect(result[0]!.pctOfTotal).toBe(0);
  });

  it("computes estimated cost using pricing map", () => {
    // claude-sonnet-4-20250514: input=$3/M, output=$15/M, cached=$0.3/M
    const rows = [
      makeRow({
        model: "claude-sonnet-4-20250514",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cached_input_tokens: 0,
        total_tokens: 2_000_000,
      }),
    ];
    const result = groupByModel(rows, pm());
    // inputCost = 1M * $3/M = $3, outputCost = 1M * $15/M = $15 → $18
    expect(result[0]!.estimatedCost).toBeCloseTo(18, 1);
  });
});

// ---------------------------------------------------------------------------
// groupByAgent
// ---------------------------------------------------------------------------

describe("groupByAgent", () => {
  it("returns empty array for no records", () => {
    expect(groupByAgent([], pm())).toEqual([]);
  });

  it("groups by source with correct aggregates", () => {
    const rows = [
      makeRow({ source: "claude-code", total_tokens: 100 }),
      makeRow({ source: "claude-code", total_tokens: 200 }),
      makeRow({ source: "opencode", model: "gpt-4o", total_tokens: 500 }),
    ];

    const result = groupByAgent(rows, pm());

    expect(result).toHaveLength(2);
    // Sorted by totalTokens descending
    expect(result[0]!.source).toBe("opencode");
    expect(result[0]!.totalTokens).toBe(500);
    expect(result[0]!.label).toBe("OpenCode");
    expect(result[1]!.source).toBe("claude-code");
    expect(result[1]!.totalTokens).toBe(300);
    expect(result[1]!.label).toBe("Claude Code");
  });

  it("includes nested model breakdown sorted by total descending", () => {
    const rows = [
      makeRow({ source: "claude-code", model: "claude-sonnet-4-20250514", total_tokens: 300 }),
      makeRow({ source: "claude-code", model: "claude-opus-4-20250514", total_tokens: 700 }),
    ];

    const result = groupByAgent(rows, pm());
    const agent = result[0]!;
    expect(agent.models).toHaveLength(2);
    expect(agent.models[0]!.model).toBe("claude-opus-4-20250514");
    expect(agent.models[0]!.total).toBe(700);
  });

  it("computes estimated cost per app", () => {
    const rows = [
      makeRow({
        source: "claude-code",
        model: "claude-sonnet-4-20250514",
        input_tokens: 1_000_000,
        output_tokens: 0,
        cached_input_tokens: 0,
        total_tokens: 1_000_000,
      }),
    ];
    const result = groupByAgent(rows, pm());
    expect(result[0]!.estimatedCost).toBeCloseTo(3, 1); // 1M input * $3/M
  });
});

// ---------------------------------------------------------------------------
// groupByDate
// ---------------------------------------------------------------------------

describe("groupByDate", () => {
  it("returns empty array for no records", () => {
    expect(groupByDate([], pm())).toEqual([]);
  });

  it("groups by date (YYYY-MM-DD) from hour_start", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-10T14:00:00Z", total_tokens: 100 }),
      makeRow({ hour_start: "2026-03-10T15:00:00Z", total_tokens: 200 }),
      makeRow({ hour_start: "2026-03-09T10:00:00Z", total_tokens: 500 }),
    ];

    const result = groupByDate(rows, pm());

    expect(result).toHaveLength(2);
    // Sorted newest-first
    expect(result[0]!.date).toBe("2026-03-10");
    expect(result[0]!.totalTokens).toBe(300);
    expect(result[1]!.date).toBe("2026-03-09");
    expect(result[1]!.totalTokens).toBe(500);
  });

  it("aggregates all token types per date", () => {
    const rows = [
      makeRow({
        hour_start: "2026-03-10T00:00:00Z",
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 10,
        total_tokens: 150,
      }),
      makeRow({
        hour_start: "2026-03-10T01:00:00Z",
        input_tokens: 200,
        output_tokens: 100,
        cached_input_tokens: 20,
        total_tokens: 300,
      }),
    ];

    const result = groupByDate(rows, pm());
    expect(result[0]!.inputTokens).toBe(300);
    expect(result[0]!.outputTokens).toBe(150);
    expect(result[0]!.cachedTokens).toBe(30);
  });

  it("includes the original records in each group", () => {
    const rows = [
      makeRow({ hour_start: "2026-03-10T14:00:00Z" }),
      makeRow({ hour_start: "2026-03-10T15:00:00Z" }),
    ];
    const result = groupByDate(rows, pm());
    expect(result[0]!.records).toHaveLength(2);
  });

  it("shifts records across midnight with positive tzOffset (UTC-8)", () => {
    // 2026-03-11T03:00Z → 2026-03-10T19:00 PST → local date 2026-03-10
    const rows = [
      makeRow({ hour_start: "2026-03-10T20:00:00Z", total_tokens: 100 }),
      makeRow({ hour_start: "2026-03-11T03:00:00Z", total_tokens: 200 }),
    ];
    const result = groupByDate(rows, pm(), 480); // UTC-8

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-10");
    expect(result[0]!.totalTokens).toBe(300);
    expect(result[0]!.records).toHaveLength(2);
  });

  it("shifts records across midnight with negative tzOffset (UTC+9)", () => {
    // 2026-03-10T20:00Z → 2026-03-11T05:00 JST → local date 2026-03-11
    const rows = [
      makeRow({ hour_start: "2026-03-10T10:00:00Z", total_tokens: 100 }),
      makeRow({ hour_start: "2026-03-10T20:00:00Z", total_tokens: 200 }),
    ];
    const result = groupByDate(rows, pm(), -540); // UTC+9

    expect(result).toHaveLength(2);
    // Sorted newest-first
    expect(result[0]!.date).toBe("2026-03-11");
    expect(result[0]!.totalTokens).toBe(200);
    expect(result[1]!.date).toBe("2026-03-10");
    expect(result[1]!.totalTokens).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// extractSources
// ---------------------------------------------------------------------------

describe("extractSources", () => {
  it("returns empty array for no records", () => {
    expect(extractSources([])).toEqual([]);
  });

  it("returns unique sources sorted alphabetically", () => {
    const rows = [
      makeRow({ source: "opencode" }),
      makeRow({ source: "claude-code" }),
      makeRow({ source: "opencode" }),
      makeRow({ source: "gemini-cli" }),
    ];
    expect(extractSources(rows)).toEqual(["claude-code", "gemini-cli", "opencode"]);
  });
});

// ---------------------------------------------------------------------------
// extractModels
// ---------------------------------------------------------------------------

describe("extractModels", () => {
  it("returns empty array for no records", () => {
    expect(extractModels([])).toEqual([]);
  });

  it("returns unique models sorted alphabetically", () => {
    const rows = [
      makeRow({ model: "gpt-4o" }),
      makeRow({ model: "claude-sonnet-4-20250514" }),
      makeRow({ model: "gpt-4o" }),
    ];
    expect(extractModels(rows)).toEqual(["claude-sonnet-4-20250514", "gpt-4o"]);
  });
});

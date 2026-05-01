import { describe, expect, it } from "vitest";
import {
  findPricingEntriesForModel,
  formatContextWindow,
  formatPerMillion,
} from "./model-info-helpers";
import type { DynamicPricingEntryDto } from "./rpc-types";

function entry(overrides: Partial<DynamicPricingEntryDto>): DynamicPricingEntryDto {
  return {
    model: "anthropic/claude-sonnet-4",
    provider: "Anthropic",
    displayName: "Claude Sonnet 4",
    inputPerMillion: 3,
    outputPerMillion: 15,
    cachedPerMillion: 0.3,
    contextWindow: 200000,
    origin: "openrouter",
    updatedAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("findPricingEntriesForModel", () => {
  it("matches by exact model id", () => {
    const e = entry({});
    expect(findPricingEntriesForModel([e], "anthropic/claude-sonnet-4")).toEqual([e]);
  });

  it("matches by alias", () => {
    const e = entry({ aliases: ["claude-sonnet-4-20250514"] });
    expect(findPricingEntriesForModel([e], "claude-sonnet-4-20250514")).toEqual([e]);
  });

  it("returns multiple entries across origins/providers, sorted baseline → openrouter → models.dev", () => {
    const a = entry({ origin: "models.dev", provider: "Z" });
    const b = entry({ origin: "openrouter", provider: "M" });
    const c = entry({ origin: "baseline", provider: "A" });
    const out = findPricingEntriesForModel([a, b, c], "anthropic/claude-sonnet-4");
    expect(out.map((x) => x.origin)).toEqual([
      "baseline",
      "openrouter",
      "models.dev",
    ]);
  });

  it("dedups by (model, provider, origin)", () => {
    const e = entry({});
    const out = findPricingEntriesForModel([e, { ...e }], "anthropic/claude-sonnet-4");
    expect(out).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const e = entry({});
    expect(
      findPricingEntriesForModel([e], "Anthropic/Claude-Sonnet-4"),
    ).toEqual([e]);
  });

  it("returns empty for unknown model", () => {
    expect(findPricingEntriesForModel([entry({})], "no-such-model")).toEqual([]);
  });

  it("returns empty for blank input", () => {
    expect(findPricingEntriesForModel([entry({})], "   ")).toEqual([]);
  });
});

describe("formatPerMillion", () => {
  it("renders null as em-dash", () => {
    expect(formatPerMillion(null)).toBe("—");
    expect(formatPerMillion(undefined)).toBe("—");
  });

  it("renders zero as $0 with no unit", () => {
    expect(formatPerMillion(0)).toBe("$0");
  });

  it("uses 4 decimals for sub-cent values", () => {
    expect(formatPerMillion(0.0008)).toBe("$0.0008 / 1M");
  });

  it("uses 2 decimals for normal values", () => {
    expect(formatPerMillion(3)).toBe("$3.00 / 1M");
    expect(formatPerMillion(0.3)).toBe("$0.30 / 1M");
  });
});

describe("formatContextWindow", () => {
  it("returns null for missing", () => {
    expect(formatContextWindow(null)).toBeNull();
    expect(formatContextWindow(0)).toBeNull();
  });

  it("renders K and M units", () => {
    expect(formatContextWindow(200_000)).toBe("200K");
    expect(formatContextWindow(8_192)).toBe("8K");
    expect(formatContextWindow(2_000_000)).toBe("2M");
    expect(formatContextWindow(1_500_000)).toBe("1.5M");
  });

  it("renders raw integer for tiny windows", () => {
    expect(formatContextWindow(900)).toBe("900");
  });
});

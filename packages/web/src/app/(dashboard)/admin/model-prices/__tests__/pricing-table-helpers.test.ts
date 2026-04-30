import { describe, it, expect } from "vitest";
import {
  sortEntries,
  filterEntries,
  originChipClass,
  formatNullable,
} from "../pricing-table-helpers";
import type { DynamicPricingEntryDto } from "@/lib/rpc-types";

function entry(
  overrides: Partial<DynamicPricingEntryDto> & { model: string },
): DynamicPricingEntryDto {
  return {
    model: overrides.model,
    provider: overrides.provider ?? "Anthropic",
    displayName: overrides.displayName ?? null,
    inputPerMillion: overrides.inputPerMillion ?? 1,
    outputPerMillion: overrides.outputPerMillion ?? 2,
    cachedPerMillion: overrides.cachedPerMillion ?? null,
    contextWindow: overrides.contextWindow ?? null,
    origin: overrides.origin ?? "baseline",
    updatedAt: overrides.updatedAt ?? "2026-04-30T00:00:00.000Z",
  };
}

describe("pricing-table-helpers", () => {
  describe("sortEntries", () => {
    it("default sort is [provider asc, model asc]", () => {
      const data = [
        entry({ model: "z", provider: "OpenAI" }),
        entry({ model: "a", provider: "OpenAI" }),
        entry({ model: "m", provider: "Anthropic" }),
      ];
      const sorted = sortEntries(data);
      expect(sorted.map((e) => `${e.provider}/${e.model}`)).toEqual([
        "Anthropic/m",
        "OpenAI/a",
        "OpenAI/z",
      ]);
    });

    it("desc reverses direction", () => {
      const data = [
        entry({ model: "a", provider: "Anthropic" }),
        entry({ model: "b", provider: "Anthropic" }),
      ];
      const sorted = sortEntries(data, "model", "desc");
      expect(sorted.map((e) => e.model)).toEqual(["b", "a"]);
    });

    it("numeric columns sort numerically not lexicographically", () => {
      const data = [
        entry({ model: "x", inputPerMillion: 10 }),
        entry({ model: "y", inputPerMillion: 2 }),
        entry({ model: "z", inputPerMillion: 9 }),
      ];
      const sorted = sortEntries(data, "inputPerMillion", "asc");
      expect(sorted.map((e) => e.inputPerMillion)).toEqual([2, 9, 10]);
    });

    it("nulls sort to the end for numeric columns", () => {
      const data = [
        entry({ model: "a", cachedPerMillion: null }),
        entry({ model: "b", cachedPerMillion: 5 }),
        entry({ model: "c", cachedPerMillion: 1 }),
      ];
      const sorted = sortEntries(data, "cachedPerMillion", "asc");
      expect(sorted.map((e) => e.cachedPerMillion)).toEqual([1, 5, null]);
    });

    it("does not mutate input", () => {
      const data = [
        entry({ model: "z" }),
        entry({ model: "a" }),
      ];
      const before = data.map((e) => e.model).join(",");
      sortEntries(data, "model");
      expect(data.map((e) => e.model).join(",")).toBe(before);
    });
  });

  describe("filterEntries", () => {
    it("case-insensitive substring match on model + displayName + provider", () => {
      const data = [
        entry({ model: "claude-sonnet-4", provider: "Anthropic", displayName: "Claude Sonnet 4" }),
        entry({ model: "gpt-4o", provider: "OpenAI", displayName: "GPT-4o" }),
        entry({ model: "gemini-1.5", provider: "Google", displayName: "Gemini" }),
      ];
      expect(filterEntries(data, "claude").map((e) => e.model)).toEqual(["claude-sonnet-4"]);
      expect(filterEntries(data, "OPENAI").map((e) => e.model)).toEqual(["gpt-4o"]);
      expect(filterEntries(data, "gemini").map((e) => e.model)).toEqual(["gemini-1.5"]);
    });

    it("empty filter returns all entries", () => {
      const data = [entry({ model: "a" }), entry({ model: "b" })];
      expect(filterEntries(data, "").length).toBe(2);
      expect(filterEntries(data, "   ").length).toBe(2);
    });

    it("no match returns empty array", () => {
      const data = [entry({ model: "a" })];
      expect(filterEntries(data, "zzz")).toEqual([]);
    });
  });

  describe("originChipClass", () => {
    it("returns the expected color class per origin", () => {
      expect(originChipClass("baseline")).toContain("muted");
      expect(originChipClass("openrouter")).toContain("blue");
      expect(originChipClass("models.dev")).toContain("emerald");
      expect(originChipClass("admin")).toContain("purple");
    });
  });

  describe("formatNullable", () => {
    it("null renders as em-dash", () => {
      expect(formatNullable(null)).toBe("—");
    });

    it("non-null renders with optional prefix", () => {
      expect(formatNullable(3)).toBe("3");
      expect(formatNullable(3, "$")).toBe("$3");
    });
  });
});

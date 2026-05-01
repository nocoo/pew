import { describe, it, expect } from "vitest";
import {
  sortEntries,
  filterEntries,
  filterByFacets,
  originChipClass,
  formatPrice,
  formatContext,
  providerIconPath,
  OPENROUTER_FALLBACK_ICON,
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

    it("nulls sort to the end even when direction is desc", () => {
      const data = [
        entry({ model: "a", cachedPerMillion: null }),
        entry({ model: "b", cachedPerMillion: 5 }),
        entry({ model: "c", cachedPerMillion: 1 }),
      ];
      const sorted = sortEntries(data, "cachedPerMillion", "desc");
      expect(sorted.map((e) => e.cachedPerMillion)).toEqual([5, 1, null]);
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
    });
  });

  describe("formatPrice", () => {
    it("null renders as em-dash", () => {
      expect(formatPrice(null)).toBe("—");
    });

    it("integer renders with 2 decimal places", () => {
      expect(formatPrice(3)).toBe("$3.00");
    });

    it("fractional value renders with 2 decimal places", () => {
      expect(formatPrice(0.3)).toBe("$0.30");
    });

    it("zero renders as $0.00", () => {
      expect(formatPrice(0)).toBe("$0.00");
    });
  });

  describe("formatContext", () => {
    it("null renders as em-dash", () => {
      expect(formatContext(null)).toBe("—");
    });

    it("values >= 1M render with M suffix", () => {
      expect(formatContext(1000000)).toBe("1M");
      expect(formatContext(2000000)).toBe("2M");
    });

    it("values >= 1K render with K suffix", () => {
      expect(formatContext(200000)).toBe("200K");
    });

    it("fractional K renders with decimal", () => {
      expect(formatContext(1500)).toBe("1.5K");
    });

    it("values < 1K render as raw number", () => {
      expect(formatContext(500)).toBe("500");
    });
  });

  describe("filterByFacets", () => {
    const data = [
      entry({ model: "claude-sonnet-4", provider: "Anthropic", origin: "baseline" }),
      entry({ model: "gpt-4o", provider: "OpenAI", origin: "openrouter" }),
      entry({ model: "gemini-1.5", provider: "Google", origin: "models.dev" }),
      entry({ model: "custom-model", provider: "Anthropic", origin: "models.dev" }),
    ];

    it("filters by provider only", () => {
      const result = filterByFacets(data, { provider: "Anthropic" });
      expect(result.map((e) => e.model)).toEqual(["claude-sonnet-4", "custom-model"]);
    });

    it("filters by origin only", () => {
      const result = filterByFacets(data, { origin: "openrouter" });
      expect(result.map((e) => e.model)).toEqual(["gpt-4o"]);
    });

    it("filters by both provider and origin", () => {
      const result = filterByFacets(data, { provider: "Anthropic", origin: "models.dev" });
      expect(result.map((e) => e.model)).toEqual(["custom-model"]);
    });

    it("empty facets return all entries (passthrough)", () => {
      const result = filterByFacets(data, {});
      expect(result).toHaveLength(4);
    });
  });

  describe("providerIconPath", () => {
    it("returns icon path for known providers (case-insensitive)", () => {
      expect(providerIconPath("Anthropic")).toEqual({ src: "/icons/providers/anthropic.svg", invert: true });
      expect(providerIconPath("OpenAI")).toEqual({ src: "/icons/providers/openai.svg", invert: true });
      expect(providerIconPath("DeepSeek")).toEqual({ src: "/icons/providers/deepseek.svg", invert: false });
    });

    it("maps Google to gemini icon", () => {
      expect(providerIconPath("Google")).toEqual({ src: "/icons/providers/gemini.svg", invert: false });
    });

    it("resolves aliases to canonical icon", () => {
      expect(providerIconPath("Meta-llama")).toEqual({ src: "/icons/providers/meta.svg", invert: false });
      expect(providerIconPath("MistralAI")).toEqual({ src: "/icons/providers/mistral.svg", invert: false });
      expect(providerIconPath("Z.ai")).toEqual({ src: "/icons/providers/zhipu.svg", invert: false });
      expect(providerIconPath("GitHub Copilot")).toEqual({ src: "/icons/providers/github.svg", invert: true });
    });

    it("returns openrouter icon for OpenRouter provider", () => {
      expect(providerIconPath("OpenRouter")).toEqual({ src: "/icons/providers/openrouter.svg", invert: false });
    });

    it("moonshot icon uses dark:invert", () => {
      expect(providerIconPath("Moonshot")).toEqual({ src: "/icons/providers/moonshot.svg", invert: true });
    });

    it("returns null for unknown providers", () => {
      expect(providerIconPath("SomeNewProvider")).toBeNull();
    });

    it("returns null for null provider", () => {
      expect(providerIconPath(null)).toBeNull();
    });
  });

  describe("OPENROUTER_FALLBACK_ICON", () => {
    it("provides openrouter icon as fallback constant", () => {
      expect(OPENROUTER_FALLBACK_ICON).toEqual({ src: "/icons/providers/openrouter.svg", invert: false });
    });
  });
});

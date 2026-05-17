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

    it("non-numeric sort by displayName handles nulls + uses localeCompare", () => {
      const data = [
        entry({ model: "a", displayName: null }),
        entry({ model: "b", displayName: "Bravo" }),
        entry({ model: "c", displayName: "Alpha" }),
      ];
      const sorted = sortEntries(data, "displayName", "asc");
      expect(sorted.map((e) => e.displayName)).toEqual(["Alpha", "Bravo", null]);
      const desc = sortEntries(data, "displayName", "desc");
      // Nulls always last, regardless of direction.
      expect(desc.map((e) => e.displayName)).toEqual(["Bravo", "Alpha", null]);
    });

    it("non-numeric sort with both values null treats them as equal (primary=0)", () => {
      const data = [
        entry({ model: "a", provider: "Z", displayName: null }),
        entry({ model: "b", provider: "A", displayName: null }),
      ];
      // Both displayName null → primary=0 → falls back to provider asc.
      const sorted = sortEntries(data, "displayName", "asc");
      expect(sorted.map((e) => e.provider)).toEqual(["A", "Z"]);
    });

    it("numeric sort with both values null falls through to secondary keys", () => {
      const data = [
        entry({ model: "b", provider: "B", cachedPerMillion: null }),
        entry({ model: "a", provider: "A", cachedPerMillion: null }),
      ];
      const sorted = sortEntries(data, "cachedPerMillion", "asc");
      // Both null → primary=0 → secondary [provider asc, model asc].
      expect(sorted.map((e) => e.provider)).toEqual(["A", "B"]);
    });

    it("sorting by provider does not re-tie-break on provider (skips secondary)", () => {
      const data = [
        entry({ model: "z", provider: "OpenAI" }),
        entry({ model: "a", provider: "OpenAI" }),
      ];
      // Same provider → key==="provider" branch skipped → falls through to model asc.
      const sorted = sortEntries(data, "provider", "asc");
      expect(sorted.map((e) => e.model)).toEqual(["a", "z"]);
    });

    it("sorting by model skips the model secondary tie-breaker (returns 0)", () => {
      const data = [
        entry({ model: "same", provider: "B" }),
        entry({ model: "same", provider: "A" }),
      ];
      // primary key=model is equal → key!=="provider" branch runs and sorts by provider.
      // key==="model" branch is skipped (no extra model compare) → returns 0 at end.
      const sorted = sortEntries(data, "model", "asc");
      expect(sorted.map((e) => e.provider)).toEqual(["A", "B"]);
    });

    it("identical entries on every key produce return-0 (final fallthrough)", () => {
      const a = entry({ model: "x", provider: "P" });
      const b = entry({ model: "x", provider: "P" });
      const sorted = sortEntries([a, b], "model", "asc");
      // Stable: order preserved.
      expect(sorted).toHaveLength(2);
    });

    it("non-numeric sort: only one side null sorts null to end", () => {
      const data = [
        entry({ model: "a", displayName: null }),
        entry({ model: "b", displayName: "X" }),
      ];
      expect(sortEntries(data, "displayName", "asc").map((e) => e.displayName)).toEqual([
        "X",
        null,
      ]);
      // Swap order, same expectation.
      const swapped = [data[1]!, data[0]!];
      expect(sortEntries(swapped, "displayName", "asc").map((e) => e.displayName)).toEqual([
        "X",
        null,
      ]);
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

    it("exact 1K boundary renders as 1K", () => {
      expect(formatContext(1000)).toBe("1K");
    });

    it("fractional M renders with decimal", () => {
      expect(formatContext(1_500_000)).toBe("1.5M");
    });

    it("zero renders as raw 0", () => {
      expect(formatContext(0)).toBe("0");
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

  describe("compareString null tie-break branches via sortEntries", () => {
    function rawEntry(
      model: string,
      provider: string | null,
    ): DynamicPricingEntryDto {
      return {
        model,
        provider,
        displayName: null,
        inputPerMillion: 1,
        outputPerMillion: 2,
        cachedPerMillion: null,
        contextWindow: null,
        origin: "baseline",
        updatedAt: "2026-04-30T00:00:00.000Z",
      };
    }

    it("compareString returns 1 when first provider is null (sort key=model with provider tiebreaker)", () => {
      // Sort by model: same model → tiebreak by provider → compareString(null, "X") = 1.
      const data = [
        rawEntry("same-model", null), // a.provider null
        rawEntry("same-model", "AnyProvider"), // b.provider non-null
      ];
      const sorted = sortEntries(data, "model", "asc");
      // null provider sorted to end (returns 1).
      expect(sorted.map((e) => e.provider)).toEqual(["AnyProvider", null]);
    });

    it("compareString returns -1 when second provider is null", () => {
      const data = [
        rawEntry("same-model", "AnyProvider"),
        rawEntry("same-model", null),
      ];
      const sorted = sortEntries(data, "model", "asc");
      // Non-null still comes first; null sorted to end via the -1 branch.
      expect(sorted.map((e) => e.provider)).toEqual(["AnyProvider", null]);
    });

    it("compareString returns 0 when both providers are null (falls through to model)", () => {
      // Same model, both providers null → compareString returns 0 → model tertiary sort.
      const data = [
        rawEntry("zzz-model", null),
        rawEntry("aaa-model", null),
      ];
      // Sort by displayName (both null) → primary 0 → fall to provider compareString (both null → 0) → model.
      const sorted = sortEntries(data, "displayName", "asc");
      expect(sorted.map((e) => e.model)).toEqual(["aaa-model", "zzz-model"]);
    });
  });

  describe("OPENROUTER_FALLBACK_ICON", () => {
    it("provides openrouter icon as fallback constant", () => {
      expect(OPENROUTER_FALLBACK_ICON).toEqual({ src: "/icons/providers/openrouter.svg", invert: false });
    });
  });
});

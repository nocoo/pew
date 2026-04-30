import { describe, it, expect } from "vitest";
import {
  getModelPricing,
  estimateCost,
  formatCost,
  getDefaultPricingMap,
  buildPricingMap,
  lookupPricing,
  DEFAULT_PREFIX_PRICES,
  DEFAULT_SOURCE_DEFAULTS,
  DEFAULT_FALLBACK,
} from "@/lib/pricing";

describe("pricing", () => {
  describe("getModelPricing", () => {
    it("should return exact match for known model", () => {
      const p = getModelPricing("claude-sonnet-4-20250514");
      expect(p.input).toBe(3);
      expect(p.output).toBe(15);
      expect(p.cached).toBe(0.3);
    });

    it("should match by prefix for versioned models", () => {
      const p = getModelPricing("claude-sonnet-4-20260101");
      expect(p.input).toBe(3);
      expect(p.output).toBe(15);
    });

    it("should strip models/ prefix for gemini", () => {
      const p = getModelPricing("models/gemini-2.5-pro-preview-0325");
      expect(p.input).toBe(1.25);
      expect(p.output).toBe(10);
    });

    it("should fall back to source default for unknown model", () => {
      const p = getModelPricing("unknown-model-xyz", "claude-code");
      expect(p.input).toBe(3);
      expect(p.output).toBe(15);
    });

    it("should fall back to codex source default for unknown model", () => {
      const p = getModelPricing("unknown-model-xyz", "codex");
      expect(p.input).toBe(2);
      expect(p.output).toBe(8);
      expect(p.cached).toBe(0.5);
    });

    it("should use global fallback for completely unknown model+source", () => {
      const p = getModelPricing("totally-unknown", "unknown-source");
      expect(p.input).toBe(3);
      expect(p.output).toBe(15);
    });

    it("should use global fallback when no source provided", () => {
      const p = getModelPricing("totally-unknown");
      expect(p.input).toBe(3);
      expect(p.output).toBe(15);
    });

    it("should return correct pricing for openai models", () => {
      expect(getModelPricing("o3").input).toBe(10);
      expect(getModelPricing("o4-mini").input).toBe(1.1);
      expect(getModelPricing("gpt-4.1").input).toBe(2);
      expect(getModelPricing("gpt-4.1-mini").input).toBe(0.4);
      expect(getModelPricing("gpt-4o").input).toBe(2.5);
      expect(getModelPricing("gpt-4o-mini").input).toBe(0.15);
    });

    it("should return correct pricing for all gemini models", () => {
      expect(getModelPricing("gemini-2.5-flash").input).toBe(0.15);
      expect(getModelPricing("gemini-2.0-flash").input).toBe(0.1);
    });
  });

  describe("estimateCost", () => {
    it("should compute correct cost with no caching", () => {
      const pricing = { input: 3, output: 15 };
      const result = estimateCost(1_000_000, 500_000, 0, pricing);

      expect(result.inputCost).toBeCloseTo(3.0);
      expect(result.outputCost).toBeCloseTo(7.5);
      expect(result.cachedCost).toBe(0);
      expect(result.totalCost).toBeCloseTo(10.5);
    });

    it("should compute correct cost with caching", () => {
      const pricing = { input: 3, output: 15, cached: 0.3 };
      // 1M input, 400K cached, 500K output
      const result = estimateCost(1_000_000, 500_000, 400_000, pricing);

      // Non-cached input = 600K → 600K/1M * 3 = 1.8
      expect(result.inputCost).toBeCloseTo(1.8);
      // Output = 500K/1M * 15 = 7.5
      expect(result.outputCost).toBeCloseTo(7.5);
      // Cached = 400K/1M * 0.3 = 0.12
      expect(result.cachedCost).toBeCloseTo(0.12);
      expect(result.totalCost).toBeCloseTo(9.42);
    });

    it("should use input * 0.1 for cached when not specified", () => {
      const pricing = { input: 10, output: 40 };
      const result = estimateCost(1_000_000, 0, 500_000, pricing);

      // Cached price = 10 * 0.1 = 1
      // Non-cached input = 500K/1M * 10 = 5
      expect(result.inputCost).toBeCloseTo(5.0);
      // Cached = 500K/1M * 1 = 0.5
      expect(result.cachedCost).toBeCloseTo(0.5);
    });

    it("should handle zero tokens", () => {
      const pricing = { input: 3, output: 15 };
      const result = estimateCost(0, 0, 0, pricing);

      expect(result.inputCost).toBe(0);
      expect(result.outputCost).toBe(0);
      expect(result.cachedCost).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it("should clamp non-cached input to zero when cached > input", () => {
      const pricing = { input: 3, output: 15, cached: 0.3 };
      // Edge case: cached > input (shouldn't happen but handle gracefully)
      const result = estimateCost(100_000, 0, 200_000, pricing);

      expect(result.inputCost).toBe(0); // clamped to 0
      expect(result.cachedCost).toBeCloseTo(0.06); // 200K/1M * 0.3
    });
  });

  describe("formatCost", () => {
    it("should format zero cost", () => {
      expect(formatCost(0)).toBe("$0.00");
    });

    it("should format very small costs with 4 decimal places", () => {
      expect(formatCost(0.0012)).toBe("$0.0012");
      expect(formatCost(0.005)).toBe("$0.0050");
    });

    it("should format sub-dollar costs with 2 decimal places", () => {
      expect(formatCost(0.42)).toBe("$0.42");
      expect(formatCost(0.99)).toBe("$0.99");
    });

    it("should format normal costs with 2 decimal places", () => {
      expect(formatCost(1.23)).toBe("$1.23");
      expect(formatCost(50.0)).toBe("$50.00");
      expect(formatCost(99.99)).toBe("$99.99");
    });

    it("should format large costs with thousand separators and no decimals", () => {
      expect(formatCost(100)).toBe("$100");
      expect(formatCost(1234.56)).toBe("$1,235");
      expect(formatCost(12345.67)).toBe("$12,346");
      expect(formatCost(1234567.89)).toBe("$1,234,568");
    });
  });

  describe("getDefaultPricingMap", () => {
    it("should return a PricingMap with safety-net only (empty exact-match table)", () => {
      const map = getDefaultPricingMap();
      expect(map.models).toEqual({});
      expect(map.prefixes).toEqual(DEFAULT_PREFIX_PRICES);
      expect(map.sourceDefaults).toEqual(DEFAULT_SOURCE_DEFAULTS);
      expect(map.fallback).toEqual(DEFAULT_FALLBACK);
    });

    it("should return a fresh copy each time (mutations don't leak)", () => {
      const map1 = getDefaultPricingMap();
      const map2 = getDefaultPricingMap();
      map1.models["test-model"] = { input: 999, output: 999 };
      expect(map2.models["test-model"]).toBeUndefined();
    });
  });

  describe("buildPricingMap", () => {
    it("writes dynamic entries into models[]", () => {
      const map = buildPricingMap({
        dynamic: [
          {
            model: "claude-sonnet-4-20250514",
            provider: "Anthropic",
            displayName: "Claude Sonnet 4",
            inputPerMillion: 3,
            outputPerMillion: 15,
            cachedPerMillion: 0.3,
            contextWindow: 200000,
            origin: "baseline",
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        ],
      });
      expect(map.models["claude-sonnet-4-20250514"]).toEqual({
        input: 3,
        output: 15,
        cached: 0.3,
      });
    });

    it("omits cached field when entry's cachedPerMillion is null", () => {
      const map = buildPricingMap({
        dynamic: [
          {
            model: "no-cache-model",
            provider: null,
            displayName: null,
            inputPerMillion: 3,
            outputPerMillion: 15,
            cachedPerMillion: null,
            contextWindow: null,
            origin: "baseline",
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        ],
      });
      expect(map.models["no-cache-model"]).toEqual({ input: 3, output: 15 });
      expect(map.models["no-cache-model"]!.cached).toBeUndefined();
    });

    it("aliases share the canonical entry's pricing", () => {
      const map = buildPricingMap({
        dynamic: [
          {
            model: "anthropic/claude-sonnet-4",
            provider: "Anthropic",
            displayName: "Claude Sonnet 4",
            inputPerMillion: 3,
            outputPerMillion: 15,
            cachedPerMillion: 0.3,
            contextWindow: 200000,
            origin: "openrouter",
            updatedAt: "2026-04-30T00:00:00.000Z",
            aliases: ["claude-sonnet-4-alias"],
          },
        ],
      });
      expect(map.models["claude-sonnet-4-alias"]).toEqual(
        map.models["anthropic/claude-sonnet-4"],
      );
    });

    it("empty dynamic input returns the safety-net only", () => {
      const map = buildPricingMap({ dynamic: [] });
      const defaults = getDefaultPricingMap();
      expect(map).toEqual(defaults);
    });
  });

  describe("lookupPricing", () => {
    const defaultMap = getDefaultPricingMap();

    it("should resolve via prefix when models table is empty", () => {
      const p = lookupPricing(defaultMap, "o3");
      expect(p).toEqual({ input: 10, output: 40, cached: 2.5 });
    });

    it("should resolve prefix match for versioned models", () => {
      const p = lookupPricing(defaultMap, "claude-sonnet-4-20261231");
      expect(p.input).toBe(3);
      expect(p.output).toBe(15);
    });

    it("should strip models/ prefix for Gemini", () => {
      const p = lookupPricing(defaultMap, "models/gemini-2.5-pro-preview-0325");
      expect(p.input).toBe(1.25);
      expect(p.output).toBe(10);
    });

    it("should fall back to source default for unknown model", () => {
      const p = lookupPricing(defaultMap, "unknown-xyz", "codex");
      expect(p.input).toBe(2);
      expect(p.output).toBe(8);
    });

    it("should fall back to global fallback for unknown model and source", () => {
      const p = lookupPricing(defaultMap, "unknown-xyz", "unknown-source");
      expect(p).toEqual(DEFAULT_FALLBACK);
    });

    it("should fall back to global fallback when no source provided", () => {
      const p = lookupPricing(defaultMap, "unknown-xyz");
      expect(p).toEqual(DEFAULT_FALLBACK);
    });

    it("dynamic exact match wins over prefix-resolved default", () => {
      const map = buildPricingMap({
        dynamic: [
          {
            model: "o3",
            provider: "OpenAI",
            displayName: "o3",
            inputPerMillion: 99,
            outputPerMillion: 199,
            cachedPerMillion: 9.9,
            contextWindow: 128000,
            origin: "baseline",
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        ],
      });
      const p = lookupPricing(map, "o3");
      expect(p).toEqual({ input: 99, output: 199, cached: 9.9 });
    });
  });
});

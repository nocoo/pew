/**
 * Cost-path cutover proof.
 *
 * C5 removes the inline DEFAULT_MODEL_PRICES table from lib/pricing.ts and
 * sources exact-match pricing from the dynamic dataset (worker-read KV with
 * a bundled baseline JSON underneath). This test pins:
 *
 *   1. Every model the pre-C5 code priced via DEFAULT_MODEL_PRICES still
 *      yields the same {input, output, cached} pricing when the new
 *      buildPricingMap is fed the baseline regression-floor JSON.
 *   2. Aliases share the same pricing pointer as their canonical entry.
 *   3. Empty inputs return only the safety net (no exact-match table).
 *
 * The 14-entry frozen LEGACY copy is duplicated here on purpose: it keeps
 * the cutover guarantee independent of any other file mutating, and 14
 * entries is small enough that duplication beats a brittle cross-package
 * test-file import.
 */

import { describe, it, expect } from "vitest";
import baselineEntries from "@/__fixtures__/baseline-model-prices.json";
import {
  buildPricingMap,
  DEFAULT_PREFIX_PRICES,
  DEFAULT_SOURCE_DEFAULTS,
  type DynamicPricingEntry,
  type ModelPricing,
} from "@/lib/pricing";

const LEGACY_DEFAULT_MODEL_PRICES: Record<string, ModelPricing> = {
  // Anthropic (Claude Code)
  "claude-sonnet-4-20250514": { input: 3, output: 15, cached: 0.3 },
  "claude-opus-4-20250514": { input: 15, output: 75, cached: 1.5 },
  "claude-3.5-sonnet-20241022": { input: 3, output: 15, cached: 0.3 },
  "claude-3.5-haiku-20241022": { input: 0.8, output: 4, cached: 0.08 },

  // Google (Gemini CLI)
  "gemini-2.5-pro": { input: 1.25, output: 10, cached: 0.31 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6, cached: 0.04 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cached: 0.025 },

  // OpenAI (OpenCode / OpenClaw)
  o3: { input: 10, output: 40, cached: 2.5 },
  "o4-mini": { input: 1.1, output: 4.4, cached: 0.275 },
  "gpt-4.1": { input: 2, output: 8, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cached: 0.025 },
  "gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
};

const dynamic = baselineEntries as DynamicPricingEntry[];

describe("pricing cutover (C5)", () => {
  it("baseline dataset prices every legacy model identically to the pre-C5 table", () => {
    const map = buildPricingMap({ dynamic });
    for (const [model, expected] of Object.entries(LEGACY_DEFAULT_MODEL_PRICES)) {
      expect(map.models[model]).toEqual(expected);
    }
  });

  it("aliases resolve to the canonical entry's pricing pointer", () => {
    const entry: DynamicPricingEntry = {
      model: "anthropic/claude-sonnet-4",
      provider: "Anthropic",
      displayName: "Claude Sonnet 4",
      inputPerMillion: 3,
      outputPerMillion: 15,
      cachedPerMillion: 0.3,
      contextWindow: 200000,
      origin: "openrouter",
      updatedAt: "2026-04-30T00:00:00.000Z",
      aliases: ["claude-sonnet-4-alias", "anthropic/claude-sonnet-4-20250514"],
    };
    const map = buildPricingMap({ dynamic: [entry] });
    expect(map.models["claude-sonnet-4-alias"]).toBe(
      map.models["anthropic/claude-sonnet-4"],
    );
    expect(map.models["anthropic/claude-sonnet-4-20250514"]).toEqual({
      input: 3,
      output: 15,
      cached: 0.3,
    });
  });

  it("empty inputs leave only the safety net (prefixes + source defaults + fallback)", () => {
    const map = buildPricingMap({ dynamic: [] });
    expect(map.models).toEqual({});
    expect(map.prefixes).toEqual(DEFAULT_PREFIX_PRICES);
    expect(map.sourceDefaults).toEqual(DEFAULT_SOURCE_DEFAULTS);
  });
});

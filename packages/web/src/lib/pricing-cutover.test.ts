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
 *   2. Admin DB rows still win over dynamic entries for the same model.
 *   3. Source-tagged admin rows scope to (source, model) only — they do NOT
 *      pollute the global `models[model]` table or the model-agnostic
 *      `sourceDefaults[source]` fallback (semantics tightened in N3).
 *   4. Aliases share the same pricing pointer as their canonical entry.
 *   5. Empty inputs return only the safety net (no exact-match table).
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
  type DbPricingRow,
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

function makeDbRow(overrides: Partial<DbPricingRow>): DbPricingRow {
  return {
    id: 1,
    model: "test-model",
    input: 5,
    output: 20,
    cached: null,
    source: null,
    note: null,
    updated_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("pricing cutover (C5)", () => {
  it("baseline dataset prices every legacy model identically to the pre-C5 table", () => {
    const map = buildPricingMap({ dynamic, dbRows: [] });
    for (const [model, expected] of Object.entries(LEGACY_DEFAULT_MODEL_PRICES)) {
      expect(map.models[model]).toEqual(expected);
    }
  });

  it("admin row with source=null wins over the dynamic baseline for the same model", () => {
    const map = buildPricingMap({
      dynamic,
      dbRows: [
        makeDbRow({
          model: "claude-sonnet-4-20250514",
          input: 99,
          output: 199,
          cached: 9.9,
        }),
      ],
    });
    expect(map.models["claude-sonnet-4-20250514"]).toEqual({
      input: 99,
      output: 199,
      cached: 9.9,
    });
  });

  it("admin row with source='codex' is scoped — it does not bleed into models[] or sourceDefaults[]", () => {
    const map = buildPricingMap({
      dynamic,
      dbRows: [
        makeDbRow({
          model: "gpt-4o",
          source: "codex",
          input: 7,
          output: 21,
          cached: 1.5,
        }),
      ],
    });
    // Scoped override lives in sourceModels, NOT in sourceDefaults or models[].
    expect(map.sourceModels?.["codex"]?.["gpt-4o"]).toEqual({
      input: 7,
      output: 21,
      cached: 1.5,
    });
    // sourceDefaults still holds the static safety-net for codex (untouched by
    // a (source, model) row — that table is the model-agnostic fallback).
    expect(map.sourceDefaults["codex"]).toEqual(DEFAULT_SOURCE_DEFAULTS["codex"]);
    // models["gpt-4o"] keeps the dynamic baseline (no leakage from the codex row).
    expect(map.models["gpt-4o"]).not.toEqual({ input: 7, output: 21, cached: 1.5 });
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
    const map = buildPricingMap({ dynamic: [entry], dbRows: [] });
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
    const map = buildPricingMap({ dynamic: [], dbRows: [] });
    expect(map.models).toEqual({});
    expect(map.prefixes).toEqual(DEFAULT_PREFIX_PRICES);
    expect(map.sourceDefaults).toEqual(DEFAULT_SOURCE_DEFAULTS);
  });
});

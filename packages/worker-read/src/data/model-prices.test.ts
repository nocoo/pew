/**
 * Regression test: the bundled baseline JSON must always cover every model in
 * the frozen LEGACY_DEFAULT_MODEL_PRICES table with identical pricing.
 *
 * Why a local frozen copy: C5 deletes web's DEFAULT_MODEL_PRICES; importing
 * from there would self-destruct on the cutover. This file is the long-term
 * regression floor independent of any other source.
 */

import { describe, it, expect } from "vitest";
import baseline from "./model-prices.json";
import type { DynamicPricingEntry } from "../sync/types";

interface LegacyPrice {
  input: number;
  output: number;
  cached?: number;
}

const LEGACY_DEFAULT_MODEL_PRICES: Record<string, LegacyPrice> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15, cached: 0.3 },
  "claude-opus-4-20250514": { input: 15, output: 75, cached: 1.5 },
  "claude-3.5-sonnet-20241022": { input: 3, output: 15, cached: 0.3 },
  "claude-3.5-haiku-20241022": { input: 0.8, output: 4, cached: 0.08 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cached: 0.31 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6, cached: 0.04 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cached: 0.025 },
  o3: { input: 10, output: 40, cached: 2.5 },
  "o4-mini": { input: 1.1, output: 4.4, cached: 0.275 },
  "gpt-4.1": { input: 2, output: 8, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cached: 0.025 },
  "gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
};

const entries = baseline as DynamicPricingEntry[];
const byModel = new Map(entries.map((e) => [e.model, e]));

describe("model-prices.json baseline", () => {
  it("covers every legacy model with identical pricing", () => {
    const missing: string[] = [];
    const mismatches: string[] = [];
    for (const [model, expected] of Object.entries(LEGACY_DEFAULT_MODEL_PRICES)) {
      const got = byModel.get(model);
      if (!got) {
        missing.push(model);
        continue;
      }
      if (got.inputPerMillion !== expected.input) {
        mismatches.push(`${model} input ${got.inputPerMillion} ≠ ${expected.input}`);
      }
      if (got.outputPerMillion !== expected.output) {
        mismatches.push(`${model} output ${got.outputPerMillion} ≠ ${expected.output}`);
      }
      const expectedCached = expected.cached ?? null;
      if (got.cachedPerMillion !== expectedCached) {
        mismatches.push(`${model} cached ${got.cachedPerMillion} ≠ ${expectedCached}`);
      }
    }
    expect({ missing, mismatches }).toEqual({ missing: [], mismatches: [] });
  });

  it("every entry conforms to DynamicPricingEntry shape", () => {
    for (const e of entries) {
      expect(typeof e.model).toBe("string");
      expect(typeof e.provider).toBe("string");
      expect(typeof e.inputPerMillion).toBe("number");
      expect(typeof e.outputPerMillion).toBe("number");
      expect(["baseline", "openrouter", "models.dev", "admin"]).toContain(e.origin);
      expect(typeof e.updatedAt).toBe("string");
    }
  });

  it("entries are sorted by [provider, model]", () => {
    const sorted = [...entries].sort((a, b) => {
      if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
      return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
    });
    expect(entries.map((e) => e.model)).toEqual(sorted.map((e) => e.model));
  });

  it("no duplicate model IDs", () => {
    expect(byModel.size).toBe(entries.length);
  });
});

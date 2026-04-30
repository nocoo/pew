/**
 * Partial-degradation matrix for the loadPricingMap helper.
 *
 * Two server entry points (/api/pricing and /api/usage/by-device) both go
 * through this helper so they share one policy. The helper now only depends
 * on the dynamic dataset (worker-read KV with bundled baseline underneath);
 * if that call fails, we fall back to the static safety-net.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadPricingMap } from "./load-pricing-map";
import { DEFAULT_PREFIX_PRICES, DEFAULT_SOURCE_DEFAULTS } from "./pricing";
import type { DbRead } from "./db";

type PricingMapDb = Pick<DbRead, "getDynamicPricing">;

function makeDb(overrides: {
  dynamic?: () => ReturnType<DbRead["getDynamicPricing"]>;
}): PricingMapDb {
  return {
    getDynamicPricing:
      overrides.dynamic ??
      vi.fn().mockResolvedValue({ entries: [], servedFrom: "baseline" }),
  };
}

describe("loadPricingMap", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("dynamic succeeds → buildPricingMap with the entries", async () => {
    const db = makeDb({
      dynamic: vi.fn().mockResolvedValue({
        entries: [
          {
            model: "claude-sonnet-4-20250514",
            provider: "Anthropic",
            displayName: "Claude Sonnet 4",
            inputPerMillion: 3,
            outputPerMillion: 15,
            cachedPerMillion: 0.3,
            contextWindow: 200000,
            origin: "baseline" as const,
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
        ],
        servedFrom: "kv" as const,
      }),
    });
    const map = await loadPricingMap(db);
    expect(map.models["claude-sonnet-4-20250514"]).toEqual({
      input: 3,
      output: 15,
      cached: 0.3,
    });
  });

  it("dynamic rejects → safety-net only (prefixes + source defaults + fallback)", async () => {
    const db = makeDb({
      dynamic: vi.fn().mockRejectedValue(new Error("worker-read down")),
    });
    const map = await loadPricingMap(db);
    expect(map.models).toEqual({});
    expect(map.prefixes).toEqual(DEFAULT_PREFIX_PRICES);
    expect(map.sourceDefaults).toEqual(DEFAULT_SOURCE_DEFAULTS);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "loadPricingMap: getDynamicPricing failed",
      expect.any(Error),
    );
  });

  it("never throws — even when db.getDynamicPricing throws synchronously", async () => {
    const db: PricingMapDb = {
      getDynamicPricing: vi.fn(() => {
        throw new Error("sync throw");
      }),
    };
    await expect(loadPricingMap(db)).resolves.toBeDefined();
  });
});

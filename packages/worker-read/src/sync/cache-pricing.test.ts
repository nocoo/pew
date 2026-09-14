import { describe, expect, it } from "vitest";
import { parseModelsDev } from "./models-dev";
import { parseOpenRouter } from "./openrouter";
import { mergePricingSources } from "./merge";

describe("public cache prices retain provenance and route-specific tiers", () => {
  it("retains models.dev writes and long-context prices", () => {
    const { entries } = parseModelsDev({ openai: { models: { "gpt-6-astra": { cost: {
      input: 10, output: 50, cache_read: 1, cache_write: 12.5,
      context_over_272k: { input: 20, output: 75, cache_read: 2, cache_write: 25 },
    } } } } }, "2026-09-01T00:00:00.000Z");
    expect(entries[0]).toMatchObject({ route: "direct", cacheWritePerMillion: 12.5,
      contextTiers: [{ minInputTokens: 272001, cacheWritePerMillion: 25 }] });
  });

  it("preserves OpenRouter's TTL and route price when direct pricing replaces the display baseline", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const openRouter = parseOpenRouter({ data: [{ id: "openai/gpt-6-astra", pricing: { prompt: "0.00001", completion: "0.00005",
      input_cache_read: "0.000001", input_cache_write: "0.0000125", input_cache_write_1h: "0.00002",
      overrides: [{ min_prompt_tokens: 272000, prompt: "0.00002", completion: "0.000075", input_cache_read: "0.000002", input_cache_write: "0.000025" }] } }] }, now).entries;
    const modelsDev = parseModelsDev({ openai: { models: { "gpt-6-astra": { cost: { input: 11, output: 51, cache_write: 13 } } } } }, now).entries;
    const merged = mergePricingSources({ baseline: [], openRouter, modelsDev, now });
    expect(openRouter[0]).toMatchObject({ cacheWrite1hPerMillion: 20, contextTiers: [{ minInputTokens: 272000 }] });
    expect(merged.entries[0]).toMatchObject({ inputPerMillion: 11, routePrices: { openrouter: { inputPerMillion: 10, cacheWrite1hPerMillion: 20 } } });
    const repeated = mergePricingSources({ baseline: merged.entries, openRouter, modelsDev, now });
    expect(repeated.entries).toEqual(merged.entries);
    expect(repeated.entries[0].routePrices?.direct).toBeUndefined();
    const refreshed = mergePricingSources({ baseline: merged.entries, openRouter: [],
      modelsDev: modelsDev.map((e) => ({ ...e, inputPerMillion: 20 })), now });
    expect(refreshed.entries[0]).toMatchObject({ inputPerMillion: 20, routePrices: {
      openrouter: { inputPerMillion: 10, cacheWrite1hPerMillion: 20 },
    } });
  });

  it("rejects overflowing rates and unsafe context thresholds", () => {
    const now = "2026-09-01T00:00:00.000Z";
    expect(parseOpenRouter({ data: [{ id: "openai/invalid", pricing: { prompt: "1e308", completion: "1" } }] }, now).entries).toEqual([]);
    const [valid] = parseOpenRouter({ data: [{ id: "openai/valid", pricing: { prompt: "0.00001", completion: "0.00005",
      input_cache_write: "1e308", overrides: [{ min_prompt_tokens: 100, prompt: "1e308", completion: "1" }] } }] }, now).entries;
    expect(valid.cacheWritePerMillion).toBeNull();
    expect(valid.contextTiers).toBeUndefined();
    const [direct] = parseModelsDev({ openai: { models: { valid: { cost: { input: 10, output: 50,
      context_over_999999999999999999999999k: { input: 20, output: 75 } } } } } }, now).entries;
    expect(direct.contextTiers).toBeUndefined();
  });
});

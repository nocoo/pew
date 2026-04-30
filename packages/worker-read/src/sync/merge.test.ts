import { describe, it, expect } from "vitest";
import { mergePricingSources } from "./merge";
import type { AdminPricingRow, DynamicPricingEntry } from "./types";

const NOW = "2026-04-30T00:00:00.000Z";

function entry(
  model: string,
  origin: DynamicPricingEntry["origin"],
  input: number,
  output: number,
  extra: Partial<DynamicPricingEntry> = {}
): DynamicPricingEntry {
  return {
    model,
    provider: extra.provider ?? "Anthropic",
    displayName: extra.displayName ?? null,
    inputPerMillion: input,
    outputPerMillion: output,
    cachedPerMillion: extra.cachedPerMillion ?? null,
    contextWindow: extra.contextWindow ?? null,
    origin,
    updatedAt: extra.updatedAt ?? NOW,
    ...(extra.aliases ? { aliases: extra.aliases } : {}),
  };
}

describe("mergePricingSources", () => {
  it("baseline only — entries unchanged, counts correct", () => {
    const baseline = [entry("anthropic/claude-sonnet-4", "baseline", 3, 15)];
    const r = mergePricingSources({
      baseline,
      openRouter: [],
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].origin).toBe("baseline");
    expect(r.meta.baselineCount).toBe(1);
    expect(r.meta.modelCount).toBe(1);
  });

  it("openrouter wins over baseline for overlapping IDs", () => {
    const baseline = [entry("anthropic/claude-sonnet-4", "baseline", 3, 15)];
    const openRouter = [entry("anthropic/claude-sonnet-4", "openrouter", 4, 20)];
    const r = mergePricingSources({
      baseline,
      openRouter,
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    expect(r.entries[0].origin).toBe("openrouter");
    expect(r.entries[0].inputPerMillion).toBe(4);
    expect(r.meta.baselineCount).toBe(0);
    expect(r.meta.openRouterCount).toBe(1);
  });

  it("zero-price protection — baseline retained", () => {
    const baseline = [entry("anthropic/claude-sonnet-4", "baseline", 3, 15)];
    const openRouter = [entry("anthropic/claude-sonnet-4", "openrouter", 0, 0)];
    const r = mergePricingSources({
      baseline,
      openRouter,
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    expect(r.entries[0].inputPerMillion).toBe(3);
    expect(r.entries[0].origin).toBe("baseline");
  });

  it("modelsDev wins over openrouter for overlapping IDs", () => {
    const openRouter = [entry("openai/gpt-4o", "openrouter", 2, 8, { provider: "OpenAI" })];
    const modelsDev = [entry("openai/gpt-4o", "models.dev", 2.5, 10, { provider: "OpenAI" })];
    const r = mergePricingSources({
      baseline: [],
      openRouter,
      modelsDev,
      admin: [],
      now: NOW,
    });
    expect(r.entries[0].origin).toBe("models.dev");
    expect(r.entries[0].inputPerMillion).toBe(2.5);
  });

  it("admin source=null overwrites entry; sourceOverrides empty", () => {
    const baseline = [entry("anthropic/claude-sonnet-4", "baseline", 3, 15)];
    const admin: AdminPricingRow[] = [
      {
        model: "anthropic/claude-sonnet-4",
        source: null,
        input: 99,
        output: 199,
        cached: 9.9,
      },
    ];
    const r = mergePricingSources({
      baseline,
      openRouter: [],
      modelsDev: [],
      admin,
      now: NOW,
    });
    expect(r.entries[0].inputPerMillion).toBe(99);
    expect(r.entries[0].cachedPerMillion).toBe(9.9);
    expect(r.entries[0].origin).toBe("admin");
    expect(r.sourceOverrides).toEqual([]);
    expect(r.meta.adminOverrideCount).toBe(1);
  });

  it("admin source='codex' goes to sourceOverrides; entries untouched", () => {
    const baseline = [entry("openai/gpt-4o", "baseline", 2.5, 10, { provider: "OpenAI" })];
    const admin: AdminPricingRow[] = [
      { model: "openai/gpt-4o", source: "codex", input: 7, output: 21, cached: 1.5 },
    ];
    const r = mergePricingSources({
      baseline,
      openRouter: [],
      modelsDev: [],
      admin,
      now: NOW,
    });
    expect(r.entries[0].inputPerMillion).toBe(2.5);
    expect(r.entries[0].origin).toBe("baseline");
    expect(r.sourceOverrides).toHaveLength(1);
    expect(r.sourceOverrides[0]).toEqual({
      source: "codex",
      model: "openai/gpt-4o",
      pricing: { input: 7, output: 21, cached: 1.5 },
    });
    expect(r.meta.adminOverrideCount).toBe(1);
  });

  it("alias expansion — single canonical claims bare name", () => {
    const baseline = [entry("anthropic/claude-sonnet-4", "baseline", 3, 15)];
    const r = mergePricingSources({
      baseline,
      openRouter: [],
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    expect(r.entries[0].aliases).toEqual(["claude-sonnet-4"]);
  });

  it("alias collision — no alias claimed", () => {
    const baseline = [
      entry("anthropic/claude-3.5-sonnet", "baseline", 3, 15, { provider: "Anthropic" }),
      entry("bedrock/claude-3.5-sonnet", "baseline", 3, 15, { provider: "Bedrock" }),
    ];
    const r = mergePricingSources({
      baseline,
      openRouter: [],
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    for (const e of r.entries) {
      expect(e.aliases).toBeUndefined();
    }
  });

  it("deterministic order — same input set, different array order in → identical entries out", () => {
    const baseline1 = [
      entry("openai/gpt-4o", "baseline", 2, 8, { provider: "OpenAI" }),
      entry("anthropic/claude-sonnet-4", "baseline", 3, 15),
    ];
    const baseline2 = [
      entry("anthropic/claude-sonnet-4", "baseline", 3, 15),
      entry("openai/gpt-4o", "baseline", 2, 8, { provider: "OpenAI" }),
    ];
    const r1 = mergePricingSources({
      baseline: baseline1,
      openRouter: [],
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    const r2 = mergePricingSources({
      baseline: baseline2,
      openRouter: [],
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    expect(r1.entries.map((e) => e.model)).toEqual(r2.entries.map((e) => e.model));
  });

  it("alias-aware: slashed upstream displaces bare baseline (no duplicate, alias claimed)", () => {
    const baseline = [entry("gpt-4o", "baseline", 2.5, 10, { provider: "OpenAI" })];
    const modelsDev = [entry("openai/gpt-4o", "models.dev", 3, 12, { provider: "OpenAI" })];
    const r = mergePricingSources({
      baseline,
      openRouter: [],
      modelsDev,
      admin: [],
      now: NOW,
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].model).toBe("openai/gpt-4o");
    expect(r.entries[0].origin).toBe("models.dev");
    expect(r.entries[0].inputPerMillion).toBe(3);
    expect(r.entries[0].aliases).toEqual(["gpt-4o"]);
  });

  it("alias-aware: zero-price upstream against bare baseline → bare baseline retained, no displacement", () => {
    const baseline = [entry("gpt-4o", "baseline", 2.5, 10, { provider: "OpenAI" })];
    const modelsDev = [entry("openai/gpt-4o", "models.dev", 0, 0, { provider: "OpenAI" })];
    const r = mergePricingSources({
      baseline,
      openRouter: [],
      modelsDev,
      admin: [],
      now: NOW,
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].model).toBe("gpt-4o");
    expect(r.entries[0].origin).toBe("baseline");
    expect(r.entries[0].inputPerMillion).toBe(2.5);
  });

  it("alias-aware does not displace non-baseline (admin/upstream) bare entries", () => {
    const openRouter = [
      entry("gpt-4o", "openrouter", 1, 4, { provider: "OpenAI" }),
      entry("openai/gpt-4o", "openrouter", 3, 12, { provider: "OpenAI" }),
    ];
    const r = mergePricingSources({
      baseline: [],
      openRouter,
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    // Both kept: bare came from upstream (not baseline) so no displacement.
    expect(r.entries.map((e) => e.model).sort()).toEqual(["gpt-4o", "openai/gpt-4o"]);
  });

  it("purity — repeated calls with same input do not mutate caller objects or duplicate aliases", () => {
    const original = entry("anthropic/claude-sonnet-4", "openrouter", 3, 15);
    const snapshot = JSON.parse(JSON.stringify(original));
    const r1 = mergePricingSources({
      baseline: [],
      openRouter: [original],
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    const r2 = mergePricingSources({
      baseline: [],
      openRouter: [original],
      modelsDev: [],
      admin: [],
      now: NOW,
    });
    expect(original).toEqual(snapshot);
    expect(r1.entries[0].aliases).toEqual(["claude-sonnet-4"]);
    expect(r2.entries[0].aliases).toEqual(["claude-sonnet-4"]);
    expect(r1.entries[0]).not.toBe(original);
  });
});

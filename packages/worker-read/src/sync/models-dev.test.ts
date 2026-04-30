import { describe, it, expect } from "vitest";
import sample from "./__fixtures__/models-dev.sample.json";
import { parseModelsDev } from "./models-dev";

const NOW = "2026-04-30T00:00:00.000Z";

describe("parseModelsDev", () => {
  it("normalizes valid entries", () => {
    const { entries } = parseModelsDev(sample, NOW);
    const sonnet = entries.find((e) => e.model === "anthropic/claude-sonnet-4");
    expect(sonnet).toBeDefined();
    expect(sonnet!.provider).toBe("Anthropic");
    expect(sonnet!.displayName).toBe("Claude Sonnet 4");
    expect(sonnet!.inputPerMillion).toBe(3);
    expect(sonnet!.outputPerMillion).toBe(15);
    expect(sonnet!.cachedPerMillion).toBe(0.3);
    expect(sonnet!.contextWindow).toBe(200000);
    expect(sonnet!.origin).toBe("models.dev");
    expect(sonnet!.updatedAt).toBe(NOW);
  });

  it("treats missing cache_read as null", () => {
    const { entries } = parseModelsDev(sample, NOW);
    const opus = entries.find((e) => e.model === "anthropic/claude-opus-4");
    expect(opus!.cachedPerMillion).toBe(null);
  });

  it("skips entries with missing input cost (warning)", () => {
    const { entries, warnings } = parseModelsDev(sample, NOW);
    expect(entries.find((e) => e.model === "openai/gpt-broken")).toBeUndefined();
    expect(warnings.some((w) => w.includes("gpt-broken"))).toBe(true);
  });

  it("skips unknown providers", () => {
    const { entries, warnings } = parseModelsDev(sample, NOW);
    expect(entries.find((e) => e.model.startsWith("unknown-vendor/"))).toBeUndefined();
    expect(warnings.some((w) => w.includes("unknown-vendor"))).toBe(true);
  });

  it("handles malformed input", () => {
    expect(parseModelsDev(null, NOW).entries).toEqual([]);
    expect(parseModelsDev([], NOW).entries).toEqual([]);
  });

  it("skips non-object models, missing-cost models, and invalid output cost", () => {
    const { entries, warnings } = parseModelsDev(
      {
        anthropic: {
          models: {
            "non-object-entry": null as unknown as Record<string, unknown>,
            "no-cost": { name: "No Cost" } as unknown as Record<string, unknown>,
            "bad-output": { cost: { input: 1, output: -3 } } as unknown as Record<string, unknown>,
          },
        },
        openai: { models: null as unknown as Record<string, unknown> },
      },
      NOW,
    );
    expect(entries).toEqual([]);
    expect(warnings.some((w) => w.includes("non-object-entry") && w.includes("non-object"))).toBe(true);
    expect(warnings.some((w) => w.includes("no-cost") && w.includes("missing cost"))).toBe(true);
    expect(warnings.some((w) => w.includes("bad-output") && w.includes("invalid output cost"))).toBe(true);
    expect(warnings.some((w) => w.includes("openai") && w.includes("no models"))).toBe(true);
  });

  it("warns when median price is suspiciously low (per-token unit guard)", () => {
    const perTokenData = {
      anthropic: {
        models: {
          "claude-sonnet-4": {
            name: "Claude Sonnet 4",
            cost: { input: 0.000003, output: 0.000015 },
            limit: { context: 200000 },
          },
        },
      },
    };
    const { warnings } = parseModelsDev(perTokenData, NOW);
    expect(warnings.some((w) => w.includes("per-token units"))).toBe(true);
  });

  it("does not warn when prices are in normal per-million range", () => {
    const { warnings } = parseModelsDev(sample, NOW);
    expect(warnings.some((w) => w.includes("per-token units"))).toBe(false);
  });
});

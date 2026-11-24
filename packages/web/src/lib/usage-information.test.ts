import { describe, expect, it } from "vitest";
import { usageInformation } from "./usage-information";
import { buildPricingMap, getDefaultPricingMap } from "./pricing";
import type { AccountedUsage } from "./accounting";
import type { AccountingGroup } from "@pew/core";

const row: AccountedUsage & { approximate_tokens?: number } = {
  source: "hermes",
  model: "test",
  input_tokens: 100,
  cached_input_tokens: 0,
  output_tokens: 10,
  total_tokens: 110,
};

describe("user-facing usage information", () => {
  it("omits empty usage and never exposes pricing or billing internals", () => {
    expect(usageInformation([], getDefaultPricingMap())).toEqual([]);
    const map = {
      ...getDefaultPricingMap(),
      meta: {
        status: "dynamic" as const,
        snapshotId: "PRIVATE_SNAPSHOT",
        fetchedAt: "2026-10-01",
        effectiveAt: null,
      },
    };
    const text = usageInformation([row], map).join(" ");
    expect(text).toContain("Costs are estimates, not invoices.");
    expect(text).toContain("Some cost details are unavailable.");
    expect(text).not.toMatch(
      /PRIVATE_SNAPSHOT|hermes|test|billing|reconciliation|provider|service tier/,
    );
  });

  it("discloses approximate dates only when relevant, without raw counts", () => {
    const message = "Some usage times are estimated; daily and hourly totals may shift.";
    expect(usageInformation([row], getDefaultPricingMap())).not.toContain(message);
    const notes = usageInformation([{ ...row, approximate_tokens: 1644 }], getDefaultPricingMap());
    expect(notes).toContain(message);
    expect(notes.join(" ")).not.toContain("1,644");
  });

  it("keeps cache coverage and net savings unavailable while details are missing", () => {
    const notes = usageInformation([row], getDefaultPricingMap());
    expect(notes).toContain("Cache details: reads unavailable; writes unavailable.");
    expect(notes).toContain("Net cache savings unavailable.");
    expect(usageInformation([row], getDefaultPricingMap(), true)).toContain("Prices are loading.");
  });

  it("retains known read coverage without inventing write coverage", () => {
    expect(
      usageInformation(
        [{ ...row, source: "codex", cached_input_tokens: 100, total_tokens: 210 }],
        getDefaultPricingMap(),
      ),
    ).toContain("Cache details: reads 100% covered; writes unavailable.");
  });

  it("preserves complete and negative savings without reported-money diagnostics", () => {
    const basis = {
      input_tokens: 100,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 100,
    };
    const group: AccountingGroup = {
      basis,
      model: "test",
      origin: "fixture",
      provider: "openai",
      route: "direct",
      service_tier: "default",
      context_tokens_min: 100,
      context_tokens_max: 100,
      request_count: 1,
      quality: "reported",
      diagnostics: [],
      counts: {
        input_total_tokens: 100,
        output_total_tokens: 0,
        cache_read_input_tokens: 0,
        cache_write_input_tokens: 100,
        cache_write_5m_input_tokens: 100,
        cache_write_1h_input_tokens: 0,
        reasoning_output_tokens: 0,
      },
      reported_costs: [
        {
          source: "hermes:none",
          kind: "estimate",
          status: "unknown",
          currency: "USD",
          units: "0",
          scale: 0,
        },
      ],
    };
    const record = {
      ...row,
      ...basis,
      accounting: [{ status: "matched" as const, basis, groups: [group] }],
    };
    const pricing = buildPricingMap({
      dynamic: [
        {
          model: "openai/test",
          provider: "OpenAI",
          route: "direct",
          displayName: null,
          origin: "models.dev",
          updatedAt: "2026-09-01",
          contextWindow: null,
          inputPerMillion: 10000,
          outputPerMillion: 20000,
          cachedPerMillion: 1000,
          cacheWritePerMillion: 15000,
        },
      ],
    });
    const notes = usageInformation([record], pricing);
    expect(notes).toContain("Net cache savings: -$0.50.");
    expect(notes).toContain("Cache details: reads 100% covered; writes 100% covered.");
    expect(notes).not.toContain("Some cost details are unavailable.");
    expect(notes.join(" ")).not.toContain("hermes:none");
  });
});

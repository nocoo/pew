import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelDonutChart } from "./compact-donut-charts";
import { ModelAreaChart } from "./model-area-chart";
import { toModelTimeline } from "./timeline-model-chart";
import type { UsageRow } from "@/lib/usage-transforms";

describe("model chart series", () => {
  it("limits visible legends without removing hidden models from share denominators", () => {
    const modelEvolution = [{ date: "2026-09-15", models: { newest: 1, a: 2, b: 3, c: 4, d: 5, Other: 85 } }];
    const donut = renderToStaticMarkup(createElement(ModelDonutChart, { modelEvolution }));
    expect(donut).toContain("newest");
    expect(donut).not.toContain(">Other<");
    expect(donut).toContain("Show all 6 series");
    expect(donut).toContain("1%");
    const area = renderToStaticMarkup(createElement(ModelAreaChart, { data: modelEvolution }));
    expect(area).not.toContain(">Other<");
    expect(area).toContain("Show all 6 series");
    expect(area).toContain("newest");
  });

  it("selects only visible timeline models and uses cache-aware totals for ranks and bars", () => {
    const basis = { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20, reasoning_output_tokens: 10, total_tokens: 180 };
    const current: UsageRow = { ...basis, source: "codex", model: "current", hour_start: "2026-03-29T10:00:00Z", accounting: [{
      status: "matched", basis, groups: [{ basis, model: "current", counts: {
        input_total_tokens: 100, output_total_tokens: 20, cache_read_input_tokens: 50,
        cache_write_input_tokens: 0, cache_write_5m_input_tokens: 0, cache_write_1h_input_tokens: 0, reasoning_output_tokens: 10,
      }, origin: "codex:usage", quality: "reported", provider: "openai", route: "direct", service_tier: "default",
      context_tokens_min: 100, context_tokens_max: 100, request_count: 1, diagnostics: [], reported_costs: [],
      }],
    }] };
    const rows: UsageRow[] = [
      { ...basis, source: "codex", model: "retired", hour_start: "2026-03-01T10:00:00Z", total_tokens: 10_000 },
      current,
      { ...basis, source: "codex", model: "runner-up", hour_start: "2026-03-30T10:00:00Z", total_tokens: 130 },
      { ...basis, source: "codex", model: "outside-period", hour_start: "2026-04-01T10:00:00Z", total_tokens: 1_000_000 },
    ];
    const { data, modelKeys } = toModelTimeline(rows, 0, "2026-03-01T00:00:00Z", "2026-03-30T23:30:00Z", 1);
    expect(modelKeys).toEqual(["runner-up", "Other"]);
    expect(data.find((point) => point.hourStart === "2026-03-29T10:00:00.000Z")?.Other).toBe(120);
    expect(data.reduce((sum, point) => sum + modelKeys.reduce((n, key) => n + Number(point[key]), 0), 0)).toBe(10_250);
  });
});

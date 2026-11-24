import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelDonutChart } from "./compact-donut-charts";
import { ModelAreaChart } from "./model-area-chart";
import { ModelEvolutionChart } from "./model-evolution-chart";
import { toModelTimeline } from "./timeline-model-chart";
import { ChartSeriesTooltip } from "./chart-series-tooltip";
import { toModelEvolutionPoints } from "@/lib/model-helpers";
import { MODEL_SERIES_LIMIT, toHourlyByModel } from "@/lib/usage-helpers";
import type { UsageRow } from "@/lib/usage-transforms";

describe("model chart series", () => {
  it("uses the overview series rules for evolution without conflating a model named Other", () => {
    const records: UsageRow[] = [
      "Other",
      "gpt-5.6",
      "models/a[b]",
      ...Array.from({ length: 99 }, (_, i) => `model-${i}`),
    ].map((model, i) => ({
      source: "codex",
      model,
      hour_start: "2026-10-01",
      input_tokens: 102 - i,
      output_tokens: 0,
      cached_input_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 102 - i,
    }));
    const html = renderToStaticMarkup(createElement(ModelEvolutionChart, { records, tzOffset: 0 }));
    expect(html).toContain('aria-label="Model Evolution"');
    expect(html).toContain("Show all 101 series");
    expect(html).toContain('title="Other"');
    expect(html).toContain('title="gpt-5.6"');
    expect(html).toContain('title="models/a[b]"');
    expect(
      renderToStaticMarkup(createElement(ModelEvolutionChart, { records: [], tzOffset: 0 })),
    ).toContain("No model data yet");
  });

  it.each([83, 100, 101])(
    "uses one hundred model slots across daily, hourly and timeline views: %s models",
    (count) => {
      const rows: UsageRow[] = Array.from({ length: count }, (_, i) => ({
        source: "codex",
        model: `raw/model-${i}`,
        hour_start: "2026-09-15T00:00:00Z",
        input_tokens: count - i,
        output_tokens: 0,
        cached_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: count - i,
      }));
      const daily = toModelEvolutionPoints(rows);
      const hourly = toHourlyByModel(rows, { from: "2026-09-15", to: "2026-09-15" });
      const timeline = toModelTimeline(
        rows,
        0,
        "2026-09-15T00:00:00Z",
        "2026-09-15T00:00:00Z",
        MODEL_SERIES_LIMIT,
      );
      expect(MODEL_SERIES_LIMIT).toBe(100);
      for (const point of [daily[0]!.models, hourly[0]!.models]) {
        expect(Object.keys(point)).toHaveLength(Math.min(count, 101));
        expect(Object.values(point).reduce((n, value) => n + value, 0)).toBe(
          (count * (count + 1)) / 2,
        );
        expect(Object.keys(point).includes("Other")).toBe(count > 100);
      }
      expect(timeline.modelKeys).toHaveLength(Math.min(count, 101));
      expect(timeline.modelKeys.reduce((n, key) => n + Number(timeline.data[0]![key]), 0)).toBe(
        (count * (count + 1)) / 2,
      );
      expect(renderToStaticMarkup(createElement(ModelAreaChart, { data: daily }))).toContain(
        `Show all ${Math.min(count, 101)} series`,
      );
    },
  );

  it("limits point details without losing hidden values or percentage totals", () => {
    const entries = Array.from({ length: 22 }, (_, i) => ({
      dataKey: `model-${i}`,
      name: `original/model-${i}`,
      value: i < 20 ? 4.5 : 5,
      color: "red",
    }));
    const html = renderToStaticMarkup(
      createElement(ChartSeriesTooltip, { entries, title: "Sep 15", percentage: true }),
    );
    expect(html).toContain("2 more series");
    expect(html).toContain("9.0%");
    expect(html).toContain("100.0%");
    expect(html.match(/title="original\/model-/g)).toHaveLength(20);
    expect(html).toContain("max-h-[calc(100dvh-2rem)]");
    expect(
      renderToStaticMarkup(
        createElement(ChartSeriesTooltip, {
          entries: [{ dataKey: "zero", value: 0, color: "red" }],
        }),
      ),
    ).toBe("");
    const tokens = renderToStaticMarkup(
      createElement(ChartSeriesTooltip, {
        entries: [{ dataKey: "bare", value: 1000, color: "red" }],
      }),
    );
    expect(tokens).toContain("bare");
    expect(tokens).toContain("1.0K");
    expect(tokens).not.toContain("more series");
  });

  it("limits visible legends without removing hidden models from share denominators", () => {
    const modelEvolution = [
      { date: "2026-09-15", models: { newest: 1, a: 2, b: 3, c: 4, d: 5, Other: 85 } },
    ];
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
    const basis = {
      input_tokens: 100,
      cached_input_tokens: 50,
      output_tokens: 20,
      reasoning_output_tokens: 10,
      total_tokens: 180,
    };
    const current: UsageRow = {
      ...basis,
      source: "codex",
      model: "current",
      hour_start: "2026-03-29T10:00:00Z",
      accounting: [
        {
          status: "matched",
          basis,
          groups: [
            {
              basis,
              model: "current",
              counts: {
                input_total_tokens: 100,
                output_total_tokens: 20,
                cache_read_input_tokens: 50,
                cache_write_input_tokens: 0,
                cache_write_5m_input_tokens: 0,
                cache_write_1h_input_tokens: 0,
                reasoning_output_tokens: 10,
              },
              origin: "codex:usage",
              quality: "reported",
              provider: "openai",
              route: "direct",
              service_tier: "default",
              context_tokens_min: 100,
              context_tokens_max: 100,
              request_count: 1,
              diagnostics: [],
              reported_costs: [],
            },
          ],
        },
      ],
    };
    const rows: UsageRow[] = [
      {
        ...basis,
        source: "codex",
        model: "retired",
        hour_start: "2026-03-01T10:00:00Z",
        total_tokens: 10_000,
      },
      current,
      {
        ...basis,
        source: "codex",
        model: "runner-up",
        hour_start: "2026-03-30T10:00:00Z",
        total_tokens: 130,
      },
      {
        ...basis,
        source: "codex",
        model: "outside-period",
        hour_start: "2026-04-01T10:00:00Z",
        total_tokens: 1_000_000,
      },
    ];
    const { data, modelKeys } = toModelTimeline(
      rows,
      0,
      "2026-03-01T00:00:00Z",
      "2026-03-30T23:30:00Z",
      1,
    );
    expect(modelKeys).toEqual(["runner-up", "Other"]);
    expect(data.find((point) => point.hourStart === "2026-03-29T10:00:00.000Z")?.Other).toBe(120);
    expect(
      data.reduce((sum, point) => sum + modelKeys.reduce((n, key) => n + Number(point[key]), 0), 0),
    ).toBe(10_250);
  });
});

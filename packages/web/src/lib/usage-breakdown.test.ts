import { describe, expect, it } from "vitest";
import type { UsageRow } from "./usage-transforms";
import { toDeviceDisplayData } from "./device-helpers";
import { toUsageBreakdown } from "./usage-breakdown";

const row = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  source: "claude-code", model: "claude-4.5", hour_start: "2026-09-02T00:00:00Z",
  input_tokens: 100, cached_input_tokens: 50, output_tokens: 20, reasoning_output_tokens: 10,
  total_tokens: 180, ...overrides,
});
const range = { start: "2026-09-01", end: "2026-09-04" };

describe("toUsageBreakdown", () => {
  it("keeps dates, stacked bars and shares consistent for mixed legacy and annotated accounting", () => {
    const legacy = row();
    const basis = { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20, reasoning_output_tokens: 10, total_tokens: 180 };
    const annotated = row({ source: "codex", model: "gpt-5.6", hour_start: "2026-09-03", accounting: [{
      status: "matched", basis, groups: [{ basis, model: "gpt-5.6", counts: {
        input_total_tokens: 100, output_total_tokens: 20, cache_read_input_tokens: 50,
        cache_write_input_tokens: 0, cache_write_5m_input_tokens: 0, cache_write_1h_input_tokens: 0, reasoning_output_tokens: 10,
      }, origin: "codex:usage", quality: "reported", provider: "openai", route: "direct", service_tier: "default",
      context_tokens_min: 100, context_tokens_max: 100, request_count: 1, diagnostics: [], reported_costs: [],
      }],
    }] });
    for (const dimension of ["model", "harness"] as const) {
      const result = toUsageBreakdown([legacy, annotated], [], dimension, range, -480);
      expect(result.total).toBe(300);
      expect(result.series.map((s) => s.total)).toEqual([180, 120]);
      expect(result.daily.map((p) => p.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
      expect(result.daily.map((p) => result.series.reduce((n, s) => n + Number(p[s.key]), 0))).toEqual([0, 180, 120, 0]);
      expect(result.series.map((s) => s.id)).toEqual(dimension === "model" ? ["claude-4.5", "gpt-5.6"] : ["claude-code", "codex"]);
    }
  });

  it("keeps all long-tail usage in Other and avoids model names becoming chart paths", () => {
    const ids = ["date", "__proto__", "gpt-5.6", "models/a[b]", "Other", ...Array.from({ length: 27 }, (_, i) => `model-${i}`)];
    const result = toUsageBreakdown(ids.map((model, i) => row({ model, input_tokens: 3200 - i * 100,
      cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 3200 - i * 100,
    })), [], "model", range, 0);
    expect(result.total).toBe(52_800);
    expect(result.series).toHaveLength(31);
    expect(result.series.at(-1)).toMatchObject({ id: null, total: 300 });
    expect(result.series.find((s) => s.id === "Other")?.total).toBe(2800);
    expect(new Set(result.series.map((s) => s.key)).size).toBe(31);
    expect(result.daily[1]?.date).toBe("2026-09-02");
    expect(result.series.reduce((n, s) => n + Number(result.daily[1]?.[s.key]), 0)).toBe(52_800);
  });

  it("shows recent models in both charts while preserving every historical token and share", () => {
    const records = [
      ...Array.from({ length: 6 }, (_, i) => row({ model: `retired-${i}`, hour_start: "2026-01-04", total_tokens: 10_000 })),
      row({ model: "current-0", hour_start: "2026-01-04", total_tokens: 2000 }),
      ...Array.from({ length: 30 }, (_, i) => row({ model: `current-${i}`, hour_start: "2026-09-09", total_tokens: 100 - i })),
      row({ model: "current-0", hour_start: "2026-09-15", total_tokens: 100 }),
      row({ model: "outside-period", hour_start: "2026-09-16", total_tokens: 1_000_000 }),
    ];
    for (const input of [records, [...records].reverse()]) {
      const result = toUsageBreakdown(input, [], "model", { start: "2026-01-04", end: "2026-09-15" }, -480);
      expect(result.series.map((s) => s.id)).toEqual([...Array.from({ length: 30 }, (_, i) => `current-${i}`), null]);
      expect(result.series.map((s) => s.total)).toEqual([2200, ...Array.from({ length: 29 }, (_, i) => 99 - i), 60_000]);
      expect(result.total).toBe(64_665);
      for (const series of result.series) {
        expect(result.daily.reduce((n, point) => n + Number(point[series.key]), 0)).toBe(series.total);
      }
      expect(result.daily.at(-1)?.other).toBe(0);
    }
  });

  it("ranks models using local calendar days and anchors historical ranges to their latest usage", () => {
    const records = [
      ...Array.from({ length: 30 }, (_, i) => row({ model: `previous-${i}`, hour_start: "2026-03-07T15:59:00Z", total_tokens: 1000 })),
      row({ model: "current", hour_start: "2026-03-07T16:00:00Z", total_tokens: 200 }),
      row({ model: "latest", hour_start: "2026-03-14T15:59:00Z", total_tokens: 100 }),
      row({ model: "empty", hour_start: "2026-03-31", total_tokens: 0 }),
    ];
    const result = toUsageBreakdown(records, [], "model", { start: "2026-03-01", end: "2026-03-31" }, -480);
    expect(result.series.slice(0, 2).map((s) => s.id)).toEqual(["current", "latest"]);
    expect(result.series).toHaveLength(31);
    expect(result.series.at(-1)).toMatchObject({ id: null, total: 2000 });
    expect(result.total).toBe(30_300);
  });

  it("only groups models beyond thirty, independently of the smaller legend", () => {
    for (const count of [6, 30]) {
      const result = toUsageBreakdown(Array.from({ length: count }, (_, i) => row({ model: `model-${i}` })), [], "model", range, 0);
      expect(result.series).toHaveLength(count);
      expect(result.series.every((series) => series.id !== null)).toBe(true);
      expect(result.total).toBe(count * 180);
    }
    const harnesses = toUsageBreakdown(Array.from({ length: 7 }, (_, i) => row({ source: `harness-${i}` })), [], "harness", range, 0);
    expect(harnesses.series).toHaveLength(6);
    expect(harnesses.series.at(-1)).toMatchObject({ id: null, total: 360 });
  });

  it("respects local day bounds and leaves daily API buckets unshifted", () => {
    const records = [
      row({ hour_start: "2026-08-31T15:59:59Z" }),
      row({ hour_start: "2026-08-31T16:00:00Z" }),
      row({ hour_start: "2026-09-01" }),
      row({ hour_start: "2026-09-01T16:00:00Z" }),
    ];
    const result = toUsageBreakdown(records, [], "model", { start: "2026-09-01", end: "2026-09-01" }, -480);
    expect(result.total).toBe(360);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0]?.[result.series[0]!.key]).toBe(360);
  });

  it("uses the device timeline without estimating a machine split or counting cache twice", () => {
    const timeline = toDeviceDisplayData({ devices: [], deviceDetails: [], timeline: [
      { ...row(), date: "2026-09-02", device_id: "default" },
      { ...row(), date: "2026-09-02", device_id: "work" },
      { ...row(), date: "2026-09-03", device_id: "work" },
    ] }).timeline;
    const result = toUsageBreakdown([row({ total_tokens: 9999 })], timeline, "device", range, -480);
    expect(result.total).toBe(540);
    expect(result.series.map((s) => [s.id, s.total])).toEqual([["work", 360], ["default", 180]]);
    expect(result.daily.map((p) => result.series.reduce((n, s) => n + Number(p[s.key]), 0))).toEqual([0, 360, 180, 0]);
  });

  it("retains calendar gaps but invents no shares when there is no usage", () => {
    for (const records of [[], [row({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 })]]) {
      const result = toUsageBreakdown(records, [], "model", range, 0);
      expect(result.total).toBe(0);
      expect(result.series).toEqual([]);
      expect(result.daily).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((date) => ({ date })));
    }
  });
});

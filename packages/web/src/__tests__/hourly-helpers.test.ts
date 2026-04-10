import { describe, it, expect } from "vitest";
import { toHourlyByDevice, toHourlyByModel, toHourlyByAgent } from "@/lib/usage-helpers";
import type { UsageRow } from "@/hooks/use-usage-data";

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-07T10:00:00Z",
    input_tokens: 1000,
    cached_input_tokens: 200,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 1700,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toHourlyByDevice
// ---------------------------------------------------------------------------

describe("toHourlyByDevice", () => {
  const defaultDateRange = { from: "2026-03-07", to: "2026-03-07" };

  it("should return 24-hour structure with empty devices for empty input", () => {
    const result = toHourlyByDevice([], [], defaultDateRange, 0);

    expect(result).toHaveLength(24);
    expect(result[0]!.hour).toBe(0);
    expect(result[23]!.hour).toBe(23);
    expect(Object.keys(result[0]!.devices)).toHaveLength(0);
  });

  it("should group tokens by hour and device", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "claude-code", model: "sonnet", total_tokens: 1000 }),
      makeRow({ hour_start: "2026-03-07T10:30:00Z", source: "claude-code", model: "sonnet", total_tokens: 500 }),
      makeRow({ hour_start: "2026-03-07T14:00:00Z", source: "opencode", model: "gpt-4", total_tokens: 2000 }),
    ];

    const deviceDetails = [
      { device_id: "device-1", source: "claude-code", model: "sonnet", total_tokens: 1500 },
      { device_id: "device-2", source: "opencode", model: "gpt-4", total_tokens: 2000 },
    ];

    const result = toHourlyByDevice(rows, deviceDetails, defaultDateRange, 0);

    expect(result).toHaveLength(24);
    // Hour 10: device-1 = 1500, device-2 = 0
    expect(result[10]!.devices["device-1"]).toBe(1500);
    expect(result[10]!.devices["device-2"]).toBe(0);
    // Hour 14: device-1 = 0, device-2 = 2000
    expect(result[14]!.devices["device-1"]).toBe(0);
    expect(result[14]!.devices["device-2"]).toBe(2000);
  });

  it("should compute daily average over date range", () => {
    // 2 days in range: Mar 7 and Mar 8
    const dateRange = { from: "2026-03-07", to: "2026-03-08" };
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "claude-code", model: "sonnet", total_tokens: 2000 }),
      makeRow({ hour_start: "2026-03-08T10:00:00Z", source: "claude-code", model: "sonnet", total_tokens: 4000 }),
    ];

    const deviceDetails = [
      { device_id: "device-1", source: "claude-code", model: "sonnet", total_tokens: 6000 },
    ];

    const result = toHourlyByDevice(rows, deviceDetails, dateRange, 0);

    // Hour 10: total 6000 / 2 days = 3000 average
    expect(result[10]!.devices["device-1"]).toBe(3000);
  });

  it("should shift hours with timezone offset (UTC-8)", () => {
    // 2026-03-07T18:00Z → PST local = 2026-03-07T10:00 → hour 10
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T18:00:00Z", source: "claude-code", model: "sonnet", total_tokens: 1000 }),
    ];

    const deviceDetails = [
      { device_id: "device-1", source: "claude-code", model: "sonnet", total_tokens: 1000 },
    ];

    const result = toHourlyByDevice(rows, deviceDetails, defaultDateRange, 480);

    expect(result[10]!.devices["device-1"]).toBe(1000);
    expect(result[18]!.devices["device-1"]).toBe(0);
  });

  it("should handle rows without matching devices", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "unknown-source", model: "unknown-model", total_tokens: 1000 }),
    ];

    // Device details exist but don't match the row's source:model
    const deviceDetails = [
      { device_id: "device-1", source: "other-source", model: "other-model", total_tokens: 2000 },
    ];

    const result = toHourlyByDevice(rows, deviceDetails, defaultDateRange, 0);

    // Tokens go to "unknown" device, but device-1 is still in the result with 0
    expect(result[10]!.devices["device-1"]).toBe(0);
    // Unknown devices are tracked but value goes to "unknown" key
    expect(result[10]!.devices["unknown"]).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// toHourlyByModel
// ---------------------------------------------------------------------------

describe("toHourlyByModel", () => {
  const defaultDateRange = { from: "2026-03-07", to: "2026-03-07" };

  it("should return 24-hour structure with empty models for empty input", () => {
    const result = toHourlyByModel([], defaultDateRange, 0, 5);

    expect(result).toHaveLength(24);
    expect(result[0]!.hour).toBe(0);
    expect(result[23]!.hour).toBe(23);
    expect(Object.keys(result[0]!.models)).toHaveLength(0);
  });

  it("should group tokens by hour and model", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "sonnet", total_tokens: 1000 }),
      makeRow({ hour_start: "2026-03-07T10:30:00Z", model: "sonnet", total_tokens: 500 }),
      makeRow({ hour_start: "2026-03-07T14:00:00Z", model: "opus", total_tokens: 2000 }),
    ];

    const result = toHourlyByModel(rows, defaultDateRange, 0, 5);

    expect(result).toHaveLength(24);
    // Hour 10: sonnet = 1500, opus = 0
    expect(result[10]!.models["sonnet"]).toBe(1500);
    expect(result[10]!.models["opus"]).toBe(0);
    // Hour 14: sonnet = 0, opus = 2000
    expect(result[14]!.models["sonnet"]).toBe(0);
    expect(result[14]!.models["opus"]).toBe(2000);
  });

  it("should bucket models beyond topN as 'Other'", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "model-1", total_tokens: 5000 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "model-2", total_tokens: 4000 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "model-3", total_tokens: 3000 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "model-4", total_tokens: 1000 }),
    ];

    // topN=2: model-1 and model-2 are top, model-3 and model-4 go to "Other"
    const result = toHourlyByModel(rows, defaultDateRange, 0, 2);

    expect(result[10]!.models["model-1"]).toBe(5000);
    expect(result[10]!.models["model-2"]).toBe(4000);
    expect(result[10]!.models["Other"]).toBe(4000); // 3000 + 1000
    expect(result[10]!.models["model-3"]).toBeUndefined();
    expect(result[10]!.models["model-4"]).toBeUndefined();
  });

  it("should compute daily average over date range", () => {
    const dateRange = { from: "2026-03-07", to: "2026-03-08" };
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "sonnet", total_tokens: 2000 }),
      makeRow({ hour_start: "2026-03-08T10:00:00Z", model: "sonnet", total_tokens: 4000 }),
    ];

    const result = toHourlyByModel(rows, dateRange, 0, 5);

    // Hour 10: total 6000 / 2 days = 3000 average
    expect(result[10]!.models["sonnet"]).toBe(3000);
  });

  it("should shift hours with timezone offset (UTC+9 JST)", () => {
    // 2026-03-07T01:00Z → JST local = 2026-03-07T10:00 → hour 10
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T01:00:00Z", model: "sonnet", total_tokens: 1000 }),
    ];

    const result = toHourlyByModel(rows, defaultDateRange, -540, 5);

    expect(result[10]!.models["sonnet"]).toBe(1000);
    expect(result[1]!.models["sonnet"]).toBe(0);
  });

  it("should not create 'Other' bucket when models <= topN", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "model-1", total_tokens: 1000 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", model: "model-2", total_tokens: 2000 }),
    ];

    const result = toHourlyByModel(rows, defaultDateRange, 0, 5);

    expect(result[10]!.models["model-1"]).toBe(1000);
    expect(result[10]!.models["model-2"]).toBe(2000);
    expect(result[10]!.models["Other"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toHourlyByAgent
// ---------------------------------------------------------------------------

describe("toHourlyByAgent", () => {
  const defaultDateRange = { from: "2026-03-07", to: "2026-03-07" };

  it("should return 24-hour structure with empty sources for empty input", () => {
    const result = toHourlyByAgent([], defaultDateRange, 0);

    expect(result).toHaveLength(24);
    expect(result[0]!.hour).toBe(0);
    expect(result[23]!.hour).toBe(23);
    expect(Object.keys(result[0]!.sources)).toHaveLength(0);
  });

  it("should group tokens by hour and source", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "claude-code", total_tokens: 1000 }),
      makeRow({ hour_start: "2026-03-07T10:30:00Z", source: "claude-code", total_tokens: 500 }),
      makeRow({ hour_start: "2026-03-07T14:00:00Z", source: "opencode", total_tokens: 2000 }),
    ];

    const result = toHourlyByAgent(rows, defaultDateRange, 0);

    expect(result).toHaveLength(24);
    // Hour 10: claude-code = 1500, opencode = 0
    expect(result[10]!.sources["claude-code"]).toBe(1500);
    expect(result[10]!.sources["opencode"]).toBe(0);
    // Hour 14: claude-code = 0, opencode = 2000
    expect(result[14]!.sources["claude-code"]).toBe(0);
    expect(result[14]!.sources["opencode"]).toBe(2000);
  });

  it("should compute daily average over date range", () => {
    const dateRange = { from: "2026-03-07", to: "2026-03-08" };
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "claude-code", total_tokens: 2000 }),
      makeRow({ hour_start: "2026-03-08T10:00:00Z", source: "claude-code", total_tokens: 4000 }),
    ];

    const result = toHourlyByAgent(rows, dateRange, 0);

    // Hour 10: total 6000 / 2 days = 3000 average
    expect(result[10]!.sources["claude-code"]).toBe(3000);
  });

  it("should shift hours with timezone offset (UTC-8)", () => {
    // 2026-03-07T18:00Z → PST local = 2026-03-07T10:00 → hour 10
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T18:00:00Z", source: "claude-code", total_tokens: 1000 }),
    ];

    const result = toHourlyByAgent(rows, defaultDateRange, 480);

    expect(result[10]!.sources["claude-code"]).toBe(1000);
    expect(result[18]!.sources["claude-code"]).toBe(0);
  });

  it("should sort source keys alphabetically", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "opencode", total_tokens: 1000 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "claude-code", total_tokens: 2000 }),
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "gemini-cli", total_tokens: 3000 }),
    ];

    const result = toHourlyByAgent(rows, defaultDateRange, 0);

    const sourceKeys = Object.keys(result[10]!.sources);
    expect(sourceKeys).toEqual(["claude-code", "gemini-cli", "opencode"]);
  });

  it("should zero-fill missing hours", () => {
    const rows: UsageRow[] = [
      makeRow({ hour_start: "2026-03-07T10:00:00Z", source: "claude-code", total_tokens: 1000 }),
    ];

    const result = toHourlyByAgent(rows, defaultDateRange, 0);

    // Hour 0 should have claude-code = 0 (zero-filled)
    expect(result[0]!.sources["claude-code"]).toBe(0);
    // Hour 10 should have the actual value
    expect(result[10]!.sources["claude-code"]).toBe(1000);
  });
});

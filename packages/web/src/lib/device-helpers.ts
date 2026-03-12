/**
 * Pure helper functions for device display and chart data transformation.
 *
 * These helpers are used by both the analytics page (/devices) and the
 * management page (/manage-devices). All functions are pure and have no
 * side effects.
 */

import type { DeviceTimelinePoint } from "@pew/core";

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** UUID regex — matches standard 8-4-4-4-12 format */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shorten a device_id for display.
 * Returns first 8 chars of UUIDs; returns non-UUIDs unchanged (e.g. "default").
 */
export function shortDeviceId(id: string): string {
  if (!id) return id;
  if (UUID_RE.test(id)) return id.slice(0, 8);
  return id;
}

/**
 * Get the display label for a device.
 * Priority: alias > "Legacy Device" (for default) > short UUID.
 */
export function deviceLabel(device: {
  alias: string | null;
  device_id: string;
}): string {
  if (device.alias) return device.alias;
  if (device.device_id === "default") return "Legacy Device";
  return shortDeviceId(device.device_id);
}

/**
 * Build a Map<device_id, display_label> for chart legend/tooltip lookup.
 */
export function buildDeviceLabelMap(
  devices: Array<{ device_id: string; alias: string | null }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of devices) {
    map.set(d.device_id, deviceLabel(d));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Chart data transformations
// ---------------------------------------------------------------------------

/**
 * Largest-remainder method (Hamilton's method) for rounding percentages.
 * Guarantees the rounded values sum to exactly `target` (default 100).
 */
function roundPercentages(
  values: number[],
  target = 100
): number[] {
  if (values.length === 0) return [];

  const floored = values.map(Math.floor);
  let remainder = target - floored.reduce((a, b) => a + b, 0);

  // Sort indices by descending fractional part, break ties by original order
  const indices = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (const { i } of indices) {
    if (remainder <= 0) break;
    floored[i]!++;
    remainder--;
  }

  return floored;
}

/** Pivoted data point for LineChart — { date, [device_id]: tokens } */
export interface DeviceTrendPoint {
  date: string;
  [deviceId: string]: string | number; // date is string, rest are numbers
}

/**
 * Pivot timeline into trend points keyed by device_id.
 * Used for multi-line LineChart where each line is a device.
 * Missing devices on a given date are zero-filled so all dates
 * have the same set of keys (required for Recharts multi-series).
 */
export function toDeviceTrendPoints(
  timeline: DeviceTimelinePoint[]
): DeviceTrendPoint[] {
  if (timeline.length === 0) return [];

  // Collect all unique device IDs and accumulate by (date, device)
  const allDevices = new Set<string>();
  const byDate = new Map<string, Map<string, number>>();

  for (const point of timeline) {
    allDevices.add(point.device_id);
    let dateMap = byDate.get(point.date);
    if (!dateMap) {
      dateMap = new Map();
      byDate.set(point.date, dateMap);
    }
    dateMap.set(point.device_id, point.total_tokens);
  }

  // Build result with zero-fill for missing devices
  const deviceKeys = Array.from(allDevices);

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateMap]) => {
      const point: DeviceTrendPoint = { date };
      for (const id of deviceKeys) {
        point[id] = dateMap.get(id) ?? 0;
      }
      return point;
    });
}

/** Percentage-based data point for 100% stacked AreaChart */
export interface DeviceSharePoint {
  date: string;
  [deviceId: string]: string | number;
}

/**
 * Convert timeline to percentage-based points for stacked area chart.
 * Each date's device values sum to 100 (percentage). Missing devices
 * on a given date are zero-filled so all dates have the same key set.
 */
export function toDeviceSharePoints(
  timeline: DeviceTimelinePoint[]
): DeviceSharePoint[] {
  if (timeline.length === 0) return [];

  // Collect all unique device IDs and group by date
  const allDevices = new Set<string>();
  const byDate = new Map<string, Map<string, number>>();

  for (const point of timeline) {
    allDevices.add(point.device_id);
    let dateMap = byDate.get(point.date);
    if (!dateMap) {
      dateMap = new Map();
      byDate.set(point.date, dateMap);
    }
    dateMap.set(point.device_id, point.total_tokens);
  }

  const deviceKeys = Array.from(allDevices);

  // Convert to percentage points using largest-remainder rounding
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateMap]) => {
      const point: DeviceSharePoint = { date };

      // Include zero-filled values for all devices
      const values = deviceKeys.map((id) => dateMap.get(id) ?? 0);
      const total = values.reduce((a, b) => a + b, 0);

      if (total > 0) {
        const rawPcts = values.map((v) => (v / total) * 100);
        const rounded = roundPercentages(rawPcts);
        for (let i = 0; i < deviceKeys.length; i++) {
          point[deviceKeys[i]!] = rounded[i]!;
        }
      } else {
        for (const id of deviceKeys) {
          point[id] = 0;
        }
      }

      return point;
    });
}

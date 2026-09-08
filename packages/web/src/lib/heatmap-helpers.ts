/**
 * Working-hours heatmap helpers extracted from working-hours-heatmap.tsx.
 *
 * `getHeatmapColor` maps a (value, maxValue) pair to one of four
 * intensity levels using the `withAlpha` palette utility.
 */

import { withAlpha } from "@/lib/palette";

export const EMPTY_COLOR = "hsl(var(--basalt-muted))";

/**
 * Map a session count to a CSS color string at one of four intensity levels.
 *
 * - 0 or maxValue=0 → empty color (muted).
 * - ratio ≤ 0.25 → alpha 0.3
 * - ratio ≤ 0.5  → alpha 0.5
 * - ratio ≤ 0.75 → alpha 0.75
 * - ratio > 0.75 → alpha 1
 */
export function getHeatmapColor(value: number, maxValue: number): string {
  if (value === 0) return EMPTY_COLOR;
  if (maxValue === 0) return EMPTY_COLOR;

  const ratio = value / maxValue;
  if (ratio <= 0.25) return withAlpha("chart-1", 0.3);
  if (ratio <= 0.5) return withAlpha("chart-1", 0.5);
  if (ratio <= 0.75) return withAlpha("chart-1", 0.75);
  return withAlpha("chart-1", 1);
}

/**
 * Hour labels for a 24h x-axis: "12a", "1a", ..., "12p", "1p", ..., "11p".
 */
export const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "12a";
  if (i < 12) return `${i}a`;
  if (i === 12) return "12p";
  return `${i - 12}p`;
});

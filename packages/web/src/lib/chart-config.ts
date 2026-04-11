/**
 * Centralized chart configuration constants.
 * Use these values to ensure consistent styling across all dashboard charts.
 *
 * Design decision notes:
 * - fontSize 11: Readable on both desktop and mobile without cluttering
 * - yAxisWidth 48: Fits formatted token values (e.g., "1.2M")
 * - yAxisWidth 52: Fits currency values with $ prefix (e.g., "$1.2K")
 * - yAxisWidth 140: Fits model/device names in horizontal bar charts
 */

// ---------------------------------------------------------------------------
// Axis configuration
// ---------------------------------------------------------------------------

/** Standard axis tick font size (used by both XAxis and YAxis) */
export const CHART_AXIS_FONT_SIZE = 11;

/** YAxis width for numeric token values */
export const CHART_Y_AXIS_WIDTH_TOKENS = 48;

/** YAxis width for currency values (slightly wider for $ prefix) */
export const CHART_Y_AXIS_WIDTH_CURRENCY = 52;

/** YAxis width for text labels (model names, device names) */
export const CHART_Y_AXIS_WIDTH_LABELS = 140;

// ---------------------------------------------------------------------------
// Chart dimensions
// ---------------------------------------------------------------------------

/** Standard chart height class (responsive) */
export const CHART_HEIGHT_CLASS = "h-[240px] md:h-[280px]";

/** Bar height for horizontal bar charts (model breakdown, device breakdown) */
export const CHART_BAR_HEIGHT = 32;

// ---------------------------------------------------------------------------
// Bar radius constants
// ---------------------------------------------------------------------------

/**
 * Bar radius for vertical bar charts (top corners rounded).
 * Applied to the top bar in a stack.
 */
export const BAR_RADIUS_VERTICAL: [number, number, number, number] = [2, 2, 0, 0];

/**
 * Bar radius for horizontal bar charts (right corners rounded).
 * Applied to the rightmost bar in a stack.
 */
export const BAR_RADIUS_HORIZONTAL: [number, number, number, number] = [0, 4, 4, 0];

/** No radius (used for middle bars in a stack) */
export const BAR_RADIUS_NONE: [number, number, number, number] = [0, 0, 0, 0];

// ---------------------------------------------------------------------------
// CartesianGrid configuration
// ---------------------------------------------------------------------------

export const CHART_GRID = {
  strokeDasharray: "3 3",
  strokeOpacity: 0.15,
} as const;

// ---------------------------------------------------------------------------
// Legend configuration
// ---------------------------------------------------------------------------

/** Legend dot size class */
export const LEGEND_DOT_CLASS = "h-2 w-2 rounded-full";

/** Legend text class */
export const LEGEND_TEXT_CLASS = "text-xs text-muted-foreground";

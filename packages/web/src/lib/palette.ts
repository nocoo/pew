// Centralized chart / visualization color palette.
// All values reference CSS custom properties defined in globals.css.
// Use these constants everywhere instead of hardcoded color strings.

/** Helper — wraps a CSS custom property name for inline style usage. */
const v = (token: string) => `hsl(var(--${token}))`;

/**
 * Returns a CSS color string with alpha from a CSS custom property.
 * Usage: `withAlpha("chart-1", 0.12)` -> `hsl(var(--chart-1) / 0.12)`
 */
export const withAlpha = (token: string, alpha: number) =>
  `hsl(var(--${token}) / ${alpha})`;

// -- 8 sequential chart colors --
// Spectrum: Violet → Magenta → Pink → Coral → Orange → Gold → Lime → Acid Lime

export const chart = {
  violet:  v("chart-1"),  // Brand violet (= --primary)
  magenta: v("chart-2"),
  pink:    v("chart-3"),
  coral:   v("chart-4"),
  orange:  v("chart-5"),
  gold:    v("chart-6"),
  lime:    v("chart-7"),
  acid:    v("chart-8"),  // Acid Lime — heatmap/achievement accent
} as const;

/** Ordered array — use for pie / donut / bar where you need N colors by index. */
export const CHART_COLORS = Object.values(chart);

/** CSS variable names (without --) matching CHART_COLORS order — for withAlpha(). */
export const CHART_TOKENS = Array.from({ length: 8 }, (_, i) => `chart-${i + 1}`) as readonly string[];

// -- Semantic aliases --

export const chartAxis = v("chart-axis");
export const chartMuted = v("chart-muted");

/** Positive / success */
export const chartPositive = v("success");

/** Negative / destructive — reuses the destructive token */
export const chartNegative = v("destructive");

/** Primary chart accent (most-used single color) */
export const chartPrimary = chart.violet;

// ---------------------------------------------------------------------------
// Stable color mapping — deterministic colors for agents & models
// ---------------------------------------------------------------------------

export interface ChartColor {
  /** CSS color string, e.g. `hsl(var(--chart-1))` */
  color: string;
  /** CSS variable name (without --) for use with `withAlpha()` */
  token: string;
}

/**
 * Fixed color assignment for known agent slugs.
 * Every agent always renders the same color across all charts.
 */
const AGENT_COLOR_MAP: Record<string, ChartColor> = {
  "claude-code":   { color: chart.violet,  token: "chart-1" },
  "opencode":      { color: chart.magenta, token: "chart-2" },
  "gemini-cli":    { color: chart.pink,    token: "chart-3" },
  "codex":         { color: chart.coral,   token: "chart-4" },
  "openclaw":      { color: chart.orange,  token: "chart-5" },
  "pi":            { color: chart.acid,    token: "chart-8" },
  "vscode-copilot":{ color: chart.gold,    token: "chart-6" },
  "copilot-cli":   { color: chart.lime,    token: "chart-7" },
};

/** Default color for unknown agents. */
const AGENT_FALLBACK: ChartColor = { color: chart.teal, token: "chart-9" };

/**
 * Get a stable color for an agent (source slug).
 * Known agents always get the same color; unknown agents get the fallback.
 */
export function agentColor(source: string): ChartColor {
  return AGENT_COLOR_MAP[source] ?? AGENT_FALLBACK;
}

/**
 * Simple string hash (djb2) mapped to chart color index.
 * Same model name → same color, regardless of array order.
 */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Get a stable color for a model name.
 * Uses a hash to deterministically pick from the 8 chart colors.
 */
export function modelColor(model: string): ChartColor {
  const idx = hashString(model) % CHART_COLORS.length;
  return { color: CHART_COLORS[idx] as string, token: CHART_TOKENS[idx] as string };
}

/**
 * Get a stable color for a team name.
 * Uses djb2 hash — works with any Unicode (CJK, emoji, etc.).
 */
export function teamColor(name: string): ChartColor {
  const idx = hashString(name) % CHART_COLORS.length;
  return { color: CHART_COLORS[idx] as string, token: CHART_TOKENS[idx] as string };
}

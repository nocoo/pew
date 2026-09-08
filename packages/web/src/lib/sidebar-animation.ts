/** Matches Basalt Sidebar `duration-300`. */
export const SIDEBAR_TRANSITION_MS = 300;

/**
 * Recharts 3 treats `debounce` as a trailing throttle.
 * Use the sidebar motion duration so the first measure cannot fire mid-animation.
 */
export const CHART_RESIZE_DEBOUNCE_MS = SIDEBAR_TRANSITION_MS;

/** Matches Basalt Sidebar `duration-300`. */
export const SIDEBAR_TRANSITION_MS = 300;

/** Quiet period after the last resize before Recharts measures again. */
export const CHART_RESIZE_DEBOUNCE_MS = 180;

/** Trailing delay that cannot fire while the sidebar width is still moving. */
export function chartResizeDebounceMs(animating: boolean): number {
  return animating ? SIDEBAR_TRANSITION_MS + CHART_RESIZE_DEBOUNCE_MS : CHART_RESIZE_DEBOUNCE_MS;
}

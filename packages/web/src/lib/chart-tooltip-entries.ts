const TOOLTIP_ENTRY_LIMIT = 20;

export function summarizeTooltipEntries<T extends { value: number }>(entries: readonly T[]) {
  const active = entries
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => b.value - a.value);
  return {
    visible: active.slice(0, TOOLTIP_ENTRY_LIMIT),
    hiddenCount: Math.max(0, active.length - TOOLTIP_ENTRY_LIMIT),
    hiddenTotal: active.slice(TOOLTIP_ENTRY_LIMIT).reduce((n, entry) => n + entry.value, 0),
    total: active.reduce((n, entry) => n + entry.value, 0),
  };
}

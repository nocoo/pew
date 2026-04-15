export interface LegendFilterArgs {
  keys: string[];
  hiddenKeys: ReadonlySet<string>;
  targetKey: string;
  metaKey?: boolean;
}

/**
 * Legend interaction rules:
 * - click: isolate target (click target again to reset all visible)
 * - cmd/ctrl+click: toggle target visibility while keeping others
 */
export function nextHiddenLegendKeys({
  keys,
  hiddenKeys,
  targetKey,
  metaKey = false,
}: LegendFilterArgs): Set<string> {
  if (!keys.includes(targetKey)) return new Set(hiddenKeys);

  if (metaKey) {
    const next = new Set(hiddenKeys);
    if (next.has(targetKey)) {
      next.delete(targetKey);
    } else {
      next.add(targetKey);
    }
    return next;
  }

  const visible = keys.filter((key) => !hiddenKeys.has(key));
  const isAlreadyIsolated = visible.length === 1 && visible[0] === targetKey;
  if (isAlreadyIsolated) return new Set();

  return new Set(keys.filter((key) => key !== targetKey));
}

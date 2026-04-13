import { useMemo } from "react";
import type { UsageRow, DailyPoint, SourceAggregate, ModelAggregate } from "@/lib/usage-transforms";
import {
  toDailyPoints,
  toSourceAggregates,
  toModelAggregates,
  sourceLabel,
} from "@/lib/usage-transforms";

interface UseDerivedUsageDataResult {
  daily: DailyPoint[];
  sources: SourceAggregate[];
  models: ModelAggregate[];
}

/**
 * Shared hook that memoizes daily, source, and model aggregations from usage
 * records. Used by both `useUsageData` and `useUserProfile` to avoid
 * duplicating the same derived-data logic.
 */
export function useDerivedUsageData(
  records: UsageRow[] | null,
  tzOffset: number,
): UseDerivedUsageDataResult {
  const daily = useMemo(
    () => (records ? toDailyPoints(records, tzOffset) : []),
    [records, tzOffset],
  );

  const sources = useMemo(
    () =>
      records
        ? toSourceAggregates(records).map((s) => ({
            ...s,
            label: sourceLabel(s.label),
          }))
        : [],
    [records],
  );

  const models = useMemo(
    () => (records ? toModelAggregates(records) : []),
    [records],
  );

  return { daily, sources, models };
}

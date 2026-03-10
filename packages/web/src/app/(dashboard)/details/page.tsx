"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import {
  useUsageData,
  toDailyPoints,
  sourceLabel,
} from "@/hooks/use-usage-data";
import { formatTokens, cn } from "@/lib/utils";
import { usePricingMap, lookupPricing, estimateCost, formatCost } from "@/hooks/use-pricing";
import type { PricingMap } from "@/hooks/use-pricing";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  groupByDate,
  extractSources,
  extractModels,
} from "@/lib/usage-helpers";
import type { DailyGroup } from "@/lib/usage-helpers";
import { getMonthRange, formatMonth, formatDate } from "@/lib/date-helpers";

// ---------------------------------------------------------------------------
// Expandable day row
// ---------------------------------------------------------------------------

function DayRow({ group, pricingMap }: { group: DailyGroup; pricingMap: PricingMap }) {
  const [expanded, setExpanded] = useState(false);

  const modelRows = useMemo(() => {
    const byKey = new Map<
      string,
      {
        source: string;
        model: string;
        input: number;
        output: number;
        cached: number;
        total: number;
        cost: number;
      }
    >();

    for (const r of group.records) {
      const key = `${r.source}:${r.model}`;
      const existing = byKey.get(key);
      const pricing = lookupPricing(pricingMap, r.model, r.source);
      const cost = estimateCost(
        r.input_tokens,
        r.output_tokens,
        r.cached_input_tokens,
        pricing
      );

      if (existing) {
        existing.input += r.input_tokens;
        existing.output += r.output_tokens;
        existing.cached += r.cached_input_tokens;
        existing.total += r.total_tokens;
        existing.cost += cost.totalCost;
      } else {
        byKey.set(key, {
          source: r.source,
          model: r.model,
          input: r.input_tokens,
          output: r.output_tokens,
          cached: r.cached_input_tokens,
          total: r.total_tokens,
          cost: cost.totalCost,
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => b.total - a.total);
  }, [group.records]);

  return (
    <>
      <tr
        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown
                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                strokeWidth={1.5}
              />
            ) : (
              <ChevronRight
                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                strokeWidth={1.5}
              />
            )}
            <span className="font-medium">{formatDate(group.date)}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {formatTokens(group.inputTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {formatTokens(group.outputTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums hidden md:table-cell">
          {formatTokens(group.cachedTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">
          {formatTokens(group.totalTokens)}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums hidden sm:table-cell">
          {formatCost(group.estimatedCost)}
        </td>
      </tr>
      {expanded &&
        modelRows.map((row) => (
          <tr
            key={`${row.source}:${row.model}`}
            className="border-b border-border/30 last:border-0 bg-accent/30"
          >
            <td className="pl-10 pr-4 py-2.5 text-xs text-muted-foreground">
              <span className="text-foreground/70">
                {sourceLabel(row.source)}
              </span>
              <span className="mx-1.5 text-border">/</span>
              <span className="font-mono text-foreground/60">{row.model}</span>
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.input)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.output)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden md:table-cell">
              {formatTokens(row.cached)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
              {formatTokens(row.total)}
            </td>
            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden sm:table-cell">
              {formatCost(row.cost)}
            </td>
          </tr>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DetailsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[280px] w-full rounded-xl" />
      <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left">
                <Skeleton className="h-3 w-16" />
              </th>
              <th className="px-4 py-3 text-right">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right hidden md:table-cell">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">
                <Skeleton className="h-3 w-12 ml-auto" />
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-28" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter select
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none rounded-md border border-border bg-secondary pl-2 pr-7 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" strokeWidth={2} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DetailsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [sourceFilter, setSourceFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  const { from, to } = getMonthRange(year, month);

  const { data, loading, error } = useUsageData({
    from,
    to,
    ...(sourceFilter ? { source: sourceFilter } : {}),
  });

  const { pricingMap } = usePricingMap();

  // Filter records client-side for model filter (API only supports source filter)
  const filteredRecords = useMemo(() => {
    if (!data) return [];
    if (!modelFilter) return data.records;
    return data.records.filter((r) => r.model === modelFilter);
  }, [data, modelFilter]);

  const daily = useMemo(() => {
    const raw = toDailyPoints(filteredRecords);
    // Build a map for quick lookup
    const byDate = new Map(raw.map((d) => [d.date, d]));
    // Pad to full month: 1st to last day
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const padded: typeof raw = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      padded.push(
        byDate.get(date) ?? {
          date,
          input: 0,
          output: 0,
          cached: 0,
          reasoning: 0,
          total: 0,
        }
      );
    }
    return padded;
  }, [filteredRecords, year, month]);

  const dailyGroups = useMemo(
    () => groupByDate(filteredRecords, pricingMap),
    [filteredRecords, pricingMap]
  );

  // Extract available sources/models from unfiltered data for filter dropdowns
  const availableSources = useMemo(
    () => (data ? extractSources(data.records) : []),
    [data]
  );
  const availableModels = useMemo(
    () => (data ? extractModels(data.records) : []),
    [data]
  );

  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth();

  function goToPrevMonth() {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
  }

  function goToNextMonth() {
    if (isCurrentMonth) return;
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header + month nav */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Daily Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Token usage broken down by day. Click a row to see per-model
            details.
          </p>
        </div>
        {/* Month pagination */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <span className="min-w-[140px] text-center text-sm font-medium">
            {formatMonth(year, month)}
          </span>
          <button
            onClick={goToNextMonth}
            disabled={isCurrentMonth}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              isCurrentMonth
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <FilterSelect
          label="Source"
          value={sourceFilter}
          onChange={setSourceFilter}
          options={availableSources.map((s) => ({
            value: s,
            label: sourceLabel(s),
          }))}
        />
        <FilterSelect
          label="Model"
          value={modelFilter}
          onChange={setModelFilter}
          options={availableModels.map((m) => ({ value: m, label: m }))}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load usage data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && <DetailsSkeleton />}

      {/* Content */}
      {!loading && data && (
        <>
          {/* Usage trend chart at top */}
          <UsageTrendChart data={daily} />

          {dailyGroups.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
              No usage data for {formatMonth(year, month)}.
            </div>
          ) : (
            <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                      Input
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                      Output
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">
                      Cached
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                      Total
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">
                      Est. Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dailyGroups.map((group) => (
                    <DayRow key={group.date} group={group} pricingMap={pricingMap} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

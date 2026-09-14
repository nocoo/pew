"use client";

import { useMemo } from "react";
import type { ReportedCost } from "@pew/core";
import { estimateUsageCost, summarizeAccounting, type AccountedUsage } from "@/lib/accounting";
import { formatCost, type PricingMap } from "@/lib/pricing";
import { formatTokens } from "@/lib/utils";

function reportedTotals(costs: ReportedCost[]): Array<ReportedCost> {
  const totals = new Map<string, ReportedCost>();
  for (const cost of costs) {
    const key = `${cost.source}|${cost.kind}|${cost.status}`;
    const previous = totals.get(key);
    if (!previous) { totals.set(key, { ...cost }); continue; }
    const scale = Math.max(previous.scale, cost.scale);
    previous.units = (BigInt(previous.units) * BigInt(10) ** BigInt(scale - previous.scale) + BigInt(cost.units) * BigInt(10) ** BigInt(scale - cost.scale)).toString();
    previous.scale = scale;
  }
  return [...totals.values()];
}

function exactUsd(cost: ReportedCost): string {
  const divisor = BigInt(10) ** BigInt(cost.scale); const units = BigInt(cost.units);
  const fraction = (units % divisor).toString().padStart(cost.scale, "0").replace(/0+$/, "");
  return `$${(units / divisor).toLocaleString("en-US")}${fraction ? `.${fraction}` : ".00"}`;
}

/** Coverage and price provenance belong beside every dashboard cost total. */
export function AccountingNotice({ records, pricingMap, loading = false }: { records: AccountedUsage[]; pricingMap: PricingMap; loading?: boolean }) {
  const { summary, writeCost, complete, netSavings, reported } = useMemo(() => {
    const costs = records.map((r) => estimateUsageCost(r, pricingMap));
    const complete = costs.every((c) => c.complete);
    return { summary: summarizeAccounting(records), writeCost: costs.reduce((n, c) => n + c.cacheWriteCost, 0),
      complete, netSavings: complete ? costs.reduce((n, c) => n + (c.netSavings ?? 0), 0) : null,
      reported: reportedTotals(costs.flatMap((c) => c.reportedCosts)) };
  }, [records, pricingMap]);
  if (records.length === 0) return null;
  const meta = pricingMap.meta;
  return (
    <div role="note" className="rounded-card border border-border/50 bg-secondary/50 px-4 py-3 text-xs text-muted-foreground space-y-2">
      <p>
        Cache writes: {summary.inputTokens > 0 && summary.writeCoverage === 0 ? "unavailable · 0% of input covered." : <>
          <span className="text-foreground tabular-nums">{formatTokens(summary.cacheWriteTokens)}</span> known tokens
          {` · ${Math.round(summary.writeCoverage * 100)}% of input covered · ${formatCost(writeCost)} estimated write cost on covered usage.`}
        </>}
      </p>
      <p>Net cache savings: <span className="text-foreground tabular-nums">{netSavings === null ? "—" : formatCost(netSavings)}</span>
        {netSavings === null ? " · Cache or pricing details are incomplete." : " · Read discount less cache write premium."}
      </p>
      <p>
        {`Cache hit rate = cache read tokens / input tokens with known read counts; covers ${Math.floor(summary.readCoverage * 100)}% of recorded input. `}
        {summary.pendingTokens > 0 ? `${formatTokens(summary.pendingTokens)} tokens await detail reconciliation. ` : ""}
        {!complete ? "Some cache, provider, service tier or context details are unavailable; cost includes assumptions and net cache savings are incomplete." : "Net cache savings deduct the cache write premium from the read discount."}
      </p>
      <p>
        {loading ? "Loading public prices…" : meta?.status === "dynamic" ? "Public price snapshot" : "Fallback public prices"}
        {meta ? ` ${meta.snapshotId.slice(0, 12)}` : ""}
        {meta?.fetchedAt ? ` · fetched ${new Date(meta.fetchedAt).toLocaleDateString()}` : ""}
        {". Estimates cover token charges; historical rates, storage fees and subscriptions may differ."}
      </p>
      {reported.map((cost) => (
        <p key={`${cost.source}|${cost.kind}|${cost.status}`}>
          {`${cost.source} reported ${cost.kind === "estimate" ? "estimate" : cost.kind === "included" ? "subscription inclusion" : "amount"} (${cost.status} records): `}
          <span className="text-foreground tabular-nums">{exactUsd(cost)}</span>
          {cost.status === "unknown" ? " · billing status unavailable" : " · covered records only"}
        </p>
      ))}
    </div>
  );
}

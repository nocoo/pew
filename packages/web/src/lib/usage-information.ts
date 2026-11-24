import { estimateUsageCost, summarizeAccounting, type AccountedUsage } from "./accounting";
import { formatCost, type PricingMap } from "./pricing";

export function usageInformation(
  records: readonly (AccountedUsage & { approximate_tokens?: number })[],
  pricing: PricingMap,
  loading = false,
): string[] {
  if (records.length === 0) return [];
  const rows = [...records];
  const summary = summarizeAccounting(rows);
  const costs = rows.map((r) => estimateUsageCost(r, pricing));
  const complete = costs.every((c) => c.complete);
  const coverage = (value: number) =>
    value > 0 ? `${Math.floor(value * 100)}% covered` : "unavailable";
  const notes = ["Costs are estimates, not invoices."];
  if (loading) notes.push("Prices are loading.");
  else if (!complete) notes.push("Some cost details are unavailable.");
  notes.push(
    `Cache details: reads ${coverage(summary.readCoverage)}; writes ${coverage(summary.writeCoverage)}.`,
  );
  notes.push(
    complete && !loading
      ? `Net cache savings: ${formatCost(costs.reduce((sum, c) => sum + Number(c.netSavings), 0))}.`
      : "Net cache savings unavailable.",
  );
  if (records.some((r) => (r.approximate_tokens ?? 0) > 0))
    notes.push("Some usage times are estimated; daily and hourly totals may shift.");
  return notes;
}

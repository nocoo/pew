import type { AccountingAnnotation, AccountingGroup, LegacyTokenCounts, PublicPriceRates, ReportedCost } from "@pew/core";
import { estimateCost, lookupPricing, type CostBreakdown, type ModelPricing, type PricingMap } from "./pricing";
import { normalizeForMatch } from "./model-info-helpers";

export interface AccountedUsage {
  source: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
  accounting?: AccountingAnnotation[];
}
type AccountedCounts = Omit<AccountedUsage, "source" | "model">;

export function modelUsage(m: { source: string; model: string; input: number; output: number; cached: number; reasoning?: number; accounting?: AccountingAnnotation[] }): AccountedUsage {
  return { source: m.source, model: m.model, input_tokens: m.input, output_tokens: m.output, cached_input_tokens: m.cached,
    reasoning_output_tokens: m.reasoning ?? 0, ...(m.accounting ? { accounting: m.accounting } : {}) };
}

const fields = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"] as const;
function basis(r: AccountedCounts): LegacyTokenCounts {
  return { input_tokens: r.input_tokens, cached_input_tokens: r.cached_input_tokens, output_tokens: r.output_tokens,
    reasoning_output_tokens: r.reasoning_output_tokens ?? 0,
    total_tokens: r.total_tokens ?? r.input_tokens + r.cached_input_tokens + r.output_tokens + (r.reasoning_output_tokens ?? 0) };
}

/** Only joined, mutually exclusive bases may be subtracted from an aggregate. */
function parts(r: AccountedCounts): { groups: AccountingGroup[]; remaining: LegacyTokenCounts; invalid: boolean; pending: boolean } {
  const original = basis(r); const remaining = { ...original }; const groups: AccountingGroup[] = [];
  const pending = r.accounting?.some((a) => a.status === "pending") ?? false;
  for (const a of r.accounting ?? []) {
    if (a.status !== "matched") continue;
    if (fields.some((f) => !Number.isSafeInteger(a.basis[f]) || a.basis[f] < 0 ||
      a.groups.reduce((n, g) => n + g.basis[f], 0) !== a.basis[f])) return { groups: [], remaining: original, invalid: true, pending };
    for (const f of fields) remaining[f] -= a.basis[f];
    groups.push(...a.groups);
  }
  if (fields.some((f) => remaining[f] < 0)) return { groups: [], remaining: original, invalid: true, pending };
  return { groups, remaining, invalid: false, pending };
}

/** Disjoint display counters. Original API fields remain the reconciliation basis. */
export function displayCounters(r: AccountedCounts): LegacyTokenCounts {
  const p = parts(r); const out = { ...p.remaining };
  for (const g of p.groups) {
    const c = g.counts;
    if (!c) { for (const f of fields) out[f] += g.basis[f]; continue; }
    // Unknown read classification retains the legacy chart partition. It must
    // not turn Hermes' unsplit read/write cache bucket into uncached input.
    const read = c.cache_read_input_tokens ?? g.basis.cached_input_tokens;
    const reasoning = c.reasoning_output_tokens ?? g.basis.reasoning_output_tokens;
    out.input_tokens += c.input_total_tokens - read;
    out.cached_input_tokens += read;
    out.output_tokens += c.output_total_tokens - reasoning;
    out.reasoning_output_tokens += reasoning;
    out.total_tokens += c.input_total_tokens + c.output_total_tokens;
  }
  return out;
}

export const accountedTotal = (r: AccountedCounts): number => displayCounters(r).total_tokens;

function fromRates(r: PublicPriceRates): ModelPricing {
  return { input: r.inputPerMillion, output: r.outputPerMillion,
    ...(r.cachedPerMillion !== null ? { cached: r.cachedPerMillion } : {}),
    ...(r.cacheWritePerMillion != null ? { cacheWrite: r.cacheWritePerMillion } : {}),
    ...(r.cacheWrite5mPerMillion != null ? { cacheWrite5m: r.cacheWrite5mPerMillion } : {}),
    ...(r.cacheWrite1hPerMillion != null ? { cacheWrite1h: r.cacheWrite1hPerMillion } : {}) };
}

function groupPrice(g: AccountingGroup, map: PricingMap, source: string): { price: ModelPricing; issues: string[] } {
  const issues: string[] = [];
  const provider = g.provider?.toLowerCase().replace(/[^a-z0-9]/g, "");
  const route = provider === "openrouter" || g.route === "openrouter" ? "openrouter" : "direct";
  const tier = g.service_tier === "standard" ? "default" : g.service_tier ?? "default";
  const billingRoute = route === "direct" ? `direct|${provider ?? "unknown"}` : route;
  const entry = map.contextualModels?.[`${billingRoute}|${normalizeForMatch(g.model)}|${tier}`];
  let price = entry ? fromRates(entry) : lookupPricing(map, g.model, source);
  if (!entry) issues.push(tier !== "default" || /-fast$/.test(g.model) ? "service_tier_unknown" : "fallback_price");
  if (!g.provider || (route === "direct" && entry?.provider?.toLowerCase().replace(/[^a-z0-9]/g, "") !== provider) ||
    (g.route !== null && g.route !== "direct" && g.route !== "openrouter")) issues.push("route_unknown");
  if (g.service_tier === null) issues.push("service_tier_unknown");
  const tiers = entry?.contextTiers ?? price.contextTiers ?? [];
  if (tiers.length > 0) {
    if (g.context_tokens_min === null || g.context_tokens_max === null) issues.push("context_unknown");
    else {
      const pick = (n: number) => tiers.filter((t) => n >= t.minInputTokens).sort((a, b) => b.minInputTokens - a.minInputTokens)[0];
      const low = pick(g.context_tokens_min); const high = pick(g.context_tokens_max);
      if (low?.minInputTokens !== high?.minInputTokens) issues.push("context_unknown");
      else if (low) price = fromRates(low);
    }
  }
  if (map.meta?.status === "fallback" || map.meta?.status === "baseline") issues.push("fallback_price");
  return { price, issues };
}

export interface AccountingCost extends CostBreakdown {
  cacheWriteCost: number;
  writePremium: number;
  readDiscount: number;
  netSavings: number | null;
  complete: boolean;
  issues: string[];
  reportedCosts: ReportedCost[];
}

/** Public price estimate. Reported amounts are preserved separately and never replace it. */
export function estimateUsageCost(r: AccountedUsage, map: PricingMap): AccountingCost {
  const p = parts(r); const fallback = lookupPricing(map, r.model, r.source);
  const result: AccountingCost = { ...estimateCost(p.remaining.input_tokens, p.remaining.output_tokens, p.remaining.cached_input_tokens,
    p.remaining.reasoning_output_tokens, fallback), cacheWriteCost: 0, writePremium: 0,
  readDiscount: r.source === "hermes" ? 0 : p.remaining.cached_input_tokens * (fallback.input - (fallback.cached ?? fallback.input * 0.1)) / 1_000_000, netSavings: null,
  complete: true, issues: [], reportedCosts: [] };
  if (p.invalid) result.issues.push("basis_mismatch");
  if (p.pending) result.issues.push("pending_reconciliation");
  if (p.remaining.total_tokens > 0) result.issues.push("cache_split_unknown");
  for (const g of p.groups) {
    result.reportedCosts.push(...g.reported_costs);
    const c = g.counts;
    if (!c) {
      const b = g.basis; const cost = estimateCost(b.input_tokens, b.output_tokens, b.cached_input_tokens, b.reasoning_output_tokens, fallback);
      result.inputCost += cost.inputCost; result.outputCost += cost.outputCost; result.cachedCost += cost.cachedCost; result.reasoningCost += cost.reasoningCost;
      result.issues.push(g.quality === "invalid" ? "invalid_counts" : "cache_split_unknown"); continue;
    }
    const { price, issues } = groupPrice(g, map, r.source); result.issues.push(...issues);
    if (c.cache_read_input_tokens === null || c.cache_write_input_tokens === null) result.issues.push("cache_split_unknown");
    const read = c.cache_read_input_tokens ?? (r.source === "hermes" ? 0 : g.basis.cached_input_tokens);
    const write = c.cache_write_input_tokens ?? 0;
    const hour = c.cache_write_1h_input_tokens ?? 0;
    const five = c.cache_write_5m_input_tokens ?? 0;
    const other = write - hour - five;
    if (read > 0 && price.cached === undefined) result.issues.push("cache_read_price_unknown");
    if ((other > 0 && price.cacheWrite === undefined) || (five > 0 && price.cacheWrite5m === undefined && price.cacheWrite === undefined) ||
      (hour > 0 && price.cacheWrite1h === undefined)) result.issues.push("cache_write_price_unknown");
    if (write > 0 && c.cache_write_1h_input_tokens === null && price.cacheWrite1h !== undefined) result.issues.push("cache_ttl_unknown");
    const readPrice = price.cached ?? price.input * 0.1;
    const writeCost = (other * (price.cacheWrite ?? price.input) + five * (price.cacheWrite5m ?? price.cacheWrite ?? price.input) +
      hour * (price.cacheWrite1h ?? price.cacheWrite ?? price.input)) / 1_000_000;
    const reasoning = c.reasoning_output_tokens ?? 0;
    result.inputCost += Math.max(0, c.input_total_tokens - read - write) * price.input / 1_000_000;
    result.outputCost += (c.output_total_tokens - reasoning) * price.output / 1_000_000;
    result.reasoningCost += reasoning * (price.reasoning ?? price.output) / 1_000_000;
    result.cachedCost += read * readPrice / 1_000_000;
    result.cacheWriteCost += writeCost;
    result.writePremium += writeCost - write * price.input / 1_000_000;
    result.readDiscount += read * (price.input - readPrice) / 1_000_000;
    if (g.diagnostics.some((d) => d.code === "invalid_counts" || d.code === "total_mismatch")) result.issues.push("source_total_mismatch");
  }
  result.totalCost = result.inputCost + result.outputCost + result.cachedCost + result.reasoningCost + result.cacheWriteCost;
  result.issues = [...new Set(result.issues)];
  result.complete = result.issues.length === 0;
  result.netSavings = result.complete ? result.readDiscount - result.writePremium : null;
  return result;
}

export interface AccountingSummary {
  inputTokens: number; outputTokens: number; totalTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number; cacheReadRate: number;
  readCoverage: number; writeCoverage: number; pendingTokens: number;
}

/** Rates are over recorded input, never cache/non-cache. Coverage explicitly excludes unknowns. */
export function summarizeAccounting(rows: AccountedUsage[]): AccountingSummary {
  const out: AccountingSummary = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    cacheReadRate: 0, readCoverage: 0, writeCoverage: 0, pendingTokens: 0 };
  let knownReadInput = 0; let knownWriteInput = 0;
  const legacy = (b: LegacyTokenCounts, source: string) => {
    const input = b.input_tokens + b.cached_input_tokens;
    out.inputTokens += input; out.outputTokens += b.output_tokens + b.reasoning_output_tokens; out.totalTokens += b.total_tokens;
    // A positive legacy cache bucket proves read usage except in Hermes,
    // which merged writes. A hardcoded/absent zero does not prove a cache miss.
    if (source !== "hermes" && b.cached_input_tokens > 0) { out.cacheReadTokens += b.cached_input_tokens; knownReadInput += input; }
  };
  for (const r of rows) {
    const p = parts(r); legacy(p.remaining, r.source);
    if (p.pending || p.invalid) out.pendingTokens += basis(r).total_tokens;
    for (const g of p.groups) {
      const c = g.counts;
      if (!c) { legacy(g.basis, r.source); continue; }
      out.inputTokens += c.input_total_tokens; out.outputTokens += c.output_total_tokens; out.totalTokens += c.input_total_tokens + c.output_total_tokens;
      if (c.cache_read_input_tokens !== null) { out.cacheReadTokens += c.cache_read_input_tokens; knownReadInput += c.input_total_tokens; }
      if (c.cache_write_input_tokens !== null) { out.cacheWriteTokens += c.cache_write_input_tokens; knownWriteInput += c.input_total_tokens; }
    }
  }
  out.cacheReadRate = knownReadInput > 0 ? out.cacheReadTokens / knownReadInput * 100 : 0;
  out.readCoverage = out.inputTokens > 0 ? knownReadInput / out.inputTokens : 0;
  out.writeCoverage = out.inputTokens > 0 ? knownWriteInput / out.inputTokens : 0;
  return out;
}

import type { AccountingCounts, AccountingGroup, LegacyTokenCounts, ReportedCost, TokenDelta } from "@pew/core";
import { usageLabel } from "./usage-evidence.js";

export function legacyCounts(t: TokenDelta): LegacyTokenCounts {
  return { input_tokens: t.inputTokens, cached_input_tokens: t.cachedInputTokens, output_tokens: t.outputTokens,
    reasoning_output_tokens: t.reasoningOutputTokens, total_tokens: t.inputTokens + t.cachedInputTokens + t.outputTokens + t.reasoningOutputTokens };
}

export function optionalToken(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function accountingLabel(value: unknown): string | null {
  const label = usageLabel(value);
  return label === "unknown" ? null : label;
}

export interface AccountingContext {
  provider?: string | null;
  route?: string | null;
  service_tier?: string | null;
}

interface GroupOptions extends AccountingContext {
  origin: string;
  model: string;
  aggregate?: boolean;
  rawTotal?: unknown;
  quality?: "reported" | "derived";
  reportedCosts?: ReportedCost[];
}

interface RawCounts {
  /** Validate exclusive raw fields too, before the legacy clamping normalizer. */
  uncachedInput?: unknown;
  visibleOutput?: unknown;
  /** Source components folded into the totals, such as Pi orchestration. */
  components?: unknown[];
  input: unknown;
  read: unknown;
  write: unknown;
  write5m?: unknown;
  write1h?: unknown;
  output: unknown;
  reasoning: unknown;
}

/** Invalid raw values remain a diagnostic; the legacy usage is still emitted unchanged. */
export function inclusiveAccounting(tokens: TokenDelta, raw: RawCounts, opts: GroupOptions): AccountingGroup {
  const { components = [], ...counters } = raw;
  const input = optionalToken(raw.input);
  const output = optionalToken(raw.output);
  const read = optionalToken(raw.read);
  const write = optionalToken(raw.write);
  const write5m = write === 0 && raw.write5m == null ? 0 : optionalToken(raw.write5m);
  const write1h = write === 0 && raw.write1h == null ? 0 : optionalToken(raw.write1h);
  const reasoning = optionalToken(raw.reasoning);
  const basis = legacyCounts(tokens);
  const counts: AccountingCounts | null = input !== null && output !== null &&
    optionalToken(input + output) !== null &&
    (read ?? 0) + (write ?? 0) <= input && (write5m ?? 0) + (write1h ?? 0) <= (write ?? 0) &&
    ((write5m === null && write1h === null) || write !== null) && (reasoning ?? 0) <= output &&
    input === basis.input_tokens + basis.cached_input_tokens &&
    output === (opts.origin.startsWith("hermes:") ? basis.output_tokens : basis.output_tokens + basis.reasoning_output_tokens) &&
    [...Object.values(counters), ...components].every((v) => v === undefined || v === null || optionalToken(v) !== null)
    ? { input_total_tokens: input, cache_read_input_tokens: read, cache_write_input_tokens: write,
      cache_write_5m_input_tokens: write5m, cache_write_1h_input_tokens: write1h,
      output_total_tokens: output, reasoning_output_tokens: reasoning }
    : null;
  const diagnostics: AccountingGroup["diagnostics"] = [];
  if (!counts) diagnostics.push({ code: "invalid_counts", raw_total_tokens: optionalToken(opts.rawTotal) });
  if (counts && optionalToken(opts.rawTotal) !== null && opts.rawTotal !== counts.input_total_tokens + counts.output_total_tokens) {
    diagnostics.push({ code: "total_mismatch", raw_total_tokens: optionalToken(opts.rawTotal) });
  }
  if (opts.aggregate) diagnostics.push({ code: "aggregate_context", raw_total_tokens: null });
  return { basis, counts, origin: usageLabel(opts.origin), model: usageLabel(opts.model),
    provider: accountingLabel(opts.provider), route: accountingLabel(opts.route), service_tier: accountingLabel(opts.service_tier),
    context_tokens_min: opts.aggregate || !counts ? null : input,
    context_tokens_max: opts.aggregate || !counts ? null : input,
    request_count: opts.aggregate ? null : 1, quality: counts ? (opts.quality ?? "reported") : "invalid",
    reported_costs: opts.reportedCosts ?? [], diagnostics };
}

export function unknownAccounting(basis: LegacyTokenCounts, model: string): AccountingGroup {
  return { basis: { input_tokens: basis.input_tokens, cached_input_tokens: basis.cached_input_tokens, output_tokens: basis.output_tokens,
    reasoning_output_tokens: basis.reasoning_output_tokens, total_tokens: basis.total_tokens },
    model: usageLabel(model), counts: null, origin: "legacy", quality: "legacy", provider: null, route: null,
    service_tier: null, context_tokens_min: null, context_tokens_max: null, request_count: null, reported_costs: [], diagnostics: [] };
}

/** Decimal integer amounts only. Grok USD ticks use scale=10. */
export function reportedCost(units: unknown, scale: number, source: string, kind: ReportedCost["kind"], status: ReportedCost["status"]): ReportedCost | null {
  if (typeof units === "number") {
    if (optionalToken(units) === null) return null;
    units = String(units);
  }
  if (typeof units !== "string" || !/^(0|[1-9]\d{0,59})$/.test(units) || !Number.isInteger(scale) || scale < 0 || scale > 18) return null;
  return { units, scale, currency: "USD", source: usageLabel(source), kind, status };
}

/** Preserve the source decimal representation; never round a dollar float into guessed ticks. */
export function decimalCost(value: unknown, source: string, kind: ReportedCost["kind"], status: ReportedCost["status"]): ReportedCost | null {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && (!Number.isFinite(value) || value < 0))) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) return null;
  const decimals = match[2] ?? "";
  const scale = decimals.length - Number(match[3] ?? 0);
  if (Math.abs(scale) > 18) return null;
  const digits = (match[1] + decimals).replace(/^0+(?=\d)/, "");
  return reportedCost(scale < 0 ? digits + "0".repeat(-scale) : digits, Math.max(0, scale), source, kind, status);
}

export function piAccounting(tokens: TokenDelta, usage: Record<string, unknown>, model: string, provider: unknown, aggregate = false): AccountingGroup {
  const orchestration = usage.orchestration && typeof usage.orchestration === "object" ? usage.orchestration as Record<string, unknown> : undefined;
  const add = (value: unknown, extra: unknown) => optionalToken(value) === null || (extra !== undefined && optionalToken(extra) === null)
    ? null : Number(value) + Number(extra ?? 0);
  const cost = usage.cost && typeof usage.cost === "object" ? (usage.cost as Record<string, unknown>).total : undefined;
  const reported = decimalCost(cost, "pi-sdk", "estimate", Number(cost) > 0 ? "complete" : "unknown");
  return inclusiveAccounting(tokens, { input: tokens.inputTokens + tokens.cachedInputTokens,
    uncachedInput: usage.input, visibleOutput: usage.output,
    components: [orchestration?.input, orchestration?.cacheRead, orchestration?.output],
    read: add(usage.cacheRead, orchestration?.cacheRead), write: usage.cacheWrite,
    write1h: usage.cacheWrite1h, write5m: usage.cacheWrite5m,
    output: add(usage.output, orchestration?.output), reasoning: usage.reasoningTokens ?? usage.reasoning }, {
    origin: "pi:usage", model, provider: accountingLabel(provider), rawTotal: usage.totalTokens,
    aggregate: aggregate || !!orchestration, reportedCosts: reported ? [reported] : [],
  });
}

/** Grouping preserves the current 200k/272k request pricing boundaries without fetching prices. */
export function mergeAccountingGroups(groups: AccountingGroup[]): AccountingGroup[] {
  const merged = new Map<string, AccountingGroup>();
  for (const group of groups) {
    const c = group.counts;
    const n = group.context_tokens_min;
    const band = n === null ? null : n > 272_000 ? 4 : n === 272_000 ? 3 : n > 200_000 ? 2 : n === 200_000 ? 1 : 0;
    const key = JSON.stringify([group.origin, group.model, group.provider, group.route, group.service_tier, group.quality, band,
      c && Object.values(c).map((v) => v === null), group.request_count === null,
      group.reported_costs.map(({ units: _units, ...metadata }) => metadata), group.diagnostics.map((d) => d.code)]);
    const existing = merged.get(key);
    if (!existing) { merged.set(key, structuredClone(group)); continue; }
    for (const k of Object.keys(existing.basis) as Array<keyof LegacyTokenCounts>) existing.basis[k] += group.basis[k];
    if (existing.counts && c) {
      for (const k of Object.keys(c) as Array<keyof AccountingCounts>) {
        if (existing.counts[k] !== null && c[k] !== null) existing.counts[k] += c[k];
      }
    }
    if (existing.context_tokens_min !== null && group.context_tokens_min !== null) existing.context_tokens_min = Math.min(existing.context_tokens_min, group.context_tokens_min);
    if (existing.context_tokens_max !== null && group.context_tokens_max !== null) existing.context_tokens_max = Math.max(existing.context_tokens_max, group.context_tokens_max);
    if (existing.request_count !== null && group.request_count !== null) existing.request_count += group.request_count;
    existing.reported_costs.forEach((cost, i) => { cost.units = (BigInt(cost.units) + BigInt(group.reported_costs[i].units)).toString(); });
    existing.diagnostics.forEach((d, i) => {
      const raw = group.diagnostics[i].raw_total_tokens;
      if (d.raw_total_tokens !== null && raw !== null) d.raw_total_tokens += raw;
      else d.raw_total_tokens = null;
    });
  }
  return [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group);
}

import { sumCounts, type AccountingAnnotation, type AccountingGroup } from "@pew/core";
import { withAccounting } from "./accounting";

type PartialRow = Record<string, unknown> & { accounting_json?: string; accounting_count?: number };
const COUNTERS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "evidence_tokens",
  "approximate_tokens",
] as const;

function multiply(value: number, count: number): number {
  const result = value * count;
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(result) ||
    result < 0
  )
    throw new Error("Count exceeds supported integer range");
  return result;
}

function scaleAnnotation(annotation: AccountingAnnotation, count: number): AccountingAnnotation {
  const scale = <T extends object>(values: T): T =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value === null ? null : multiply(value, count),
      ]),
    ) as T;
  return {
    ...annotation,
    basis: scale(annotation.basis),
    groups: annotation.groups.map(
      (group): AccountingGroup => ({
        ...group,
        basis: scale(group.basis),
        counts: group.counts ? scale(group.counts) : null,
        request_count: group.request_count === null ? null : multiply(group.request_count, count),
        diagnostics: group.diagnostics.map((d) => ({
          ...d,
          raw_total_tokens:
            d.raw_total_tokens === null ? null : multiply(d.raw_total_tokens, count),
        })),
        reported_costs: group.reported_costs.map((cost) => ({
          ...cost,
          units: (BigInt(cost.units) * BigInt(count)).toString(),
        })),
      }),
    ),
  };
}

/** Partition SQL by one annotation so no device/day result concatenates unbounded history into a D1 value. */
export function mergeUsageRows<T extends object>(
  rows: T[],
  dimensions: string[],
  includeReportedCosts = false,
): Array<
  Omit<T, "accounting_json" | "accounting_count"> & { accounting?: AccountingAnnotation[] }
> {
  const merged = new Map<string, PartialRow & { accounting?: AccountingAnnotation[] }>();
  for (const raw of rows) {
    const { accounting_count = 1, ...row } = raw as PartialRow;
    const value = withAccounting(row, includeReportedCosts);
    if (value.accounting)
      value.accounting = value.accounting.map((a) => scaleAnnotation(a, accounting_count));
    const key = JSON.stringify(dimensions.map((field) => value[field]));
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, value);
      continue;
    }
    for (const field of COUNTERS) {
      if (typeof value[field] === "number")
        previous[field] = sumCounts(Number(previous[field] ?? 0), value[field]);
    }
    for (const field of ["first_seen", "last_seen"]) {
      if (
        typeof value[field] === "string" &&
        (typeof previous[field] !== "string" ||
          (field === "first_seen"
            ? Date.parse(value[field]) < Date.parse(previous[field])
            : Date.parse(value[field]) > Date.parse(previous[field])))
      ) {
        previous[field] = value[field];
      }
    }
    for (const field of ["sources", "models"]) {
      if (typeof value[field] === "string")
        previous[field] = [
          ...new Set(`${previous[field] ?? ""},${value[field]}`.split(",").filter(Boolean)),
        ].join(",");
    }
    if (value.accounting) {
      previous.accounting ??= [];
      for (const annotation of value.accounting) previous.accounting.push(annotation);
    }
  }
  return [...merged.values()] as Array<
    Omit<T, "accounting_json" | "accounting_count"> & { accounting?: AccountingAnnotation[] }
  >;
}

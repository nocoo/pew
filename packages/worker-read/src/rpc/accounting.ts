import type { AccountingAnnotation, AccountingGroup } from "@pew/core";

/** Flatten SQL grouping layers; private amounts require an explicit authenticated caller. */
export function withAccounting<T extends { accounting_json?: string }>(row: T, includeReportedCosts = false): Omit<T, "accounting_json"> & { accounting?: AccountingAnnotation[] } {
  const { accounting_json, ...base } = row;
  if (!accounting_json) return base;
  const annotations: AccountingAnnotation[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (value === null) return;
    if (!value || typeof value !== "object") throw new Error("Invalid accounting annotation");
    const a = value as AccountingAnnotation;
    if ((a.status !== "matched" && a.status !== "pending") || !a.basis || !Array.isArray(a.groups)) throw new Error("Invalid accounting annotation");
    annotations.push({ status: a.status, basis: a.basis, groups: a.status === "pending" ? [] : a.groups.map((g: AccountingGroup) => ({
      ...g, reported_costs: includeReportedCosts ? g.reported_costs : [],
    })) });
  };
  visit(JSON.parse(accounting_json));
  return { ...base, ...(annotations.length > 0 ? { accounting: annotations } : {}) };
}

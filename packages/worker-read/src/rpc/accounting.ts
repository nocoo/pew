import type { AccountingAnnotation, AccountingGroup } from "@pew/core";

/** Filter indexed bases before annotating; callers aggregate only once at their display grain. */
export const ACCOUNTED_USAGE_SQL = `
  SELECT b.*,
    CASE WHEN d.user_id IS NULL THEN NULL ELSE json_object(
      'status', CASE WHEN b.input_tokens = d.input_tokens AND b.cached_input_tokens = d.cached_input_tokens
        AND b.output_tokens = d.output_tokens AND b.reasoning_output_tokens = d.reasoning_output_tokens
        AND b.total_tokens = d.total_tokens AND b.evidence_snapshot_seq IS d.evidence_snapshot_seq THEN 'matched' ELSE 'pending' END,
      'basis', json_object('input_tokens', d.input_tokens, 'cached_input_tokens', d.cached_input_tokens,
        'output_tokens', d.output_tokens, 'reasoning_output_tokens', d.reasoning_output_tokens, 'total_tokens', d.total_tokens),
      'groups', json(d.groups_json)) END AS accounting_json
  FROM usage_bases b LEFT JOIN usage_details d ON b.user_id = d.user_id AND b.device_id = d.device_id
    AND b.source = d.source AND b.model = d.model AND b.hour_start = d.hour_start AND b.event_id = d.event_id
  WHERE b.user_id = ? AND b.hour_start >= ? AND b.hour_start < ?
    AND (b.event_id = '' OR b.total_tokens > 0)
`;

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

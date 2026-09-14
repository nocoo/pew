import { describe, expect, it } from "vitest";
import { withAccounting } from "./accounting";
import { accountingFixture } from "../../../core/src/__test-helpers__/accounting";

describe("accounting read boundary", () => {
  it("flattens SQL aggregation layers, drops empty annotations and preserves the original counters", () => {
    const r = accountingFixture();
    const cost = { units: "12345678901234567890", scale: 10, currency: "USD", source: "server", kind: "actual", status: "complete" };
    const annotation = { status: "matched", basis: r.basis, groups: [{ ...r.groups[0], reported_costs: [cost] }] };
    const row = { ...r.basis, accounting_json: JSON.stringify([null, [[annotation]], { ...annotation, status: "pending" }]) };
    expect(withAccounting(row)).toMatchObject({ ...r.basis, accounting: [{ status: "matched", groups: [{ reported_costs: [] }] }, { status: "pending", groups: [] }] });
    expect(withAccounting(row, true).accounting?.[0]?.groups[0]?.reported_costs).toEqual([cost]);
    expect(withAccounting({ ...r.basis, accounting_json: "[null,[]]" })).toEqual(r.basis);
    expect(withAccounting({ ...r.basis, accounting_json: "" })).toEqual(r.basis);
  });

  it.each([false, 7, "PRIVATE", { status: "future", basis: {}, groups: [] },
    { status: "matched", groups: [] }, { status: "pending", basis: {}, groups: null }])("refuses malformed stored annotations instead of presenting trusted billing (%s)", (value) => {
    expect(() => withAccounting({ accounting_json: JSON.stringify([value]) })).toThrow("Invalid accounting annotation");
  });
});

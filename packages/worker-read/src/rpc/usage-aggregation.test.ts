import { describe, expect, it } from "vitest";
import { accountingFixture } from "../../../core/src/__test-helpers__/accounting";
import { mergeUsageRows } from "./usage-aggregation";

describe("bounded device aggregation", () => {
  it("combines partial dimensions and scales repeated annotations, not request context", () => {
    const fixture = accountingFixture();
    const group = {
      ...fixture.groups[0],
      reported_costs: [
        {
          source: "private",
          units: "10",
          scale: 0,
          kind: "actual",
          status: "complete",
          currency: "USD",
        },
      ],
      diagnostics: [{ code: "total_mismatch", raw_total_tokens: 950 }],
    };
    const annotation = { status: "matched", basis: fixture.basis, groups: [group] };
    const rows = [
      {
        device_id: "d",
        total_tokens: 1880,
        input_tokens: 200,
        first_seen: "2026-01-03",
        last_seen: "2026-01-04",
        sources: "codex",
        models: "gpt",
        accounting_count: 2,
        accounting_json: JSON.stringify(annotation),
      },
      {
        device_id: "d",
        total_tokens: 940,
        input_tokens: 100,
        first_seen: "2026-01-01",
        last_seen: "2026-01-05",
        sources: "pi,codex",
        models: "gpt,m",
        accounting_json: JSON.stringify({ ...annotation, status: "pending" }),
      },
    ];
    const original = structuredClone(rows);
    const [result] = mergeUsageRows(rows, ["device_id"]);
    expect(result).toMatchObject({
      total_tokens: 2820,
      input_tokens: 300,
      first_seen: "2026-01-01",
      last_seen: "2026-01-05",
      sources: "codex,pi",
      models: "gpt,m",
    });
    expect(result.accounting).toMatchObject([
      {
        status: "matched",
        basis: { total_tokens: 1880 },
        groups: [
          {
            basis: { total_tokens: 1880 },
            counts: {
              input_total_tokens: 1800,
              cache_read_input_tokens: 1600,
              cache_write_5m_input_tokens: null,
            },
            request_count: 2,
            context_tokens_min: 900,
            context_tokens_max: 900,
            reported_costs: [],
            diagnostics: [{ raw_total_tokens: 1900 }],
          },
        ],
      },
      { status: "pending", basis: fixture.basis, groups: [] },
    ]);
    expect(result).not.toHaveProperty("accounting_count");
    expect(result).not.toHaveProperty("accounting_json");
    expect(rows).toEqual(original);
  });

  it("keeps device/model/day partitions, empty annotations and unknown metadata distinct", () => {
    const fixture = accountingFixture();
    const annotation = {
      status: "matched",
      basis: fixture.basis,
      groups: [
        {
          ...fixture.groups[0],
          counts: null,
          request_count: null,
          diagnostics: [{ code: "invalid_counts", raw_total_tokens: null }],
        },
      ],
    };
    const a = {
      device_id: "a",
      source: "codex",
      model: "m",
      date: "2026-01-01",
      total_tokens: 940,
      accounting_json: JSON.stringify(annotation),
    };
    const rows = [
      a,
      { ...a, accounting_json: "null" },
      { ...a, device_id: "b" },
      { ...a, model: "other" },
      { ...a, date: "2026-01-02" },
    ];
    const result = mergeUsageRows(rows, ["device_id", "model", "date"]);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      total_tokens: 1880,
      accounting: [
        {
          groups: [
            { counts: null, request_count: null, diagnostics: [{ raw_total_tokens: null }] },
          ],
        },
      ],
    });
    expect(mergeUsageRows([], ["device_id"])).toEqual([]);
  });

  it("rejects unsafe scaling and summed counters", () => {
    const fixture = accountingFixture();
    expect(() =>
      mergeUsageRows(
        [
          {
            accounting_json: JSON.stringify({
              status: "pending",
              basis: fixture.basis,
              groups: [],
            }),
            accounting_count: Number.MAX_SAFE_INTEGER,
          },
        ],
        [],
      ),
    ).toThrow("Count exceeds");
    for (const count of [0, -1, 0.5])
      expect(() =>
        mergeUsageRows(
          [
            {
              accounting_json: JSON.stringify({
                status: "pending",
                basis: fixture.basis,
                groups: [],
              }),
              accounting_count: count,
            },
          ],
          [],
        ),
      ).toThrow();
    expect(() =>
      mergeUsageRows(
        [
          {
            accounting_json: JSON.stringify({
              status: "pending",
              basis: { ...fixture.basis, input_tokens: 0.5 },
              groups: [],
            }),
            accounting_count: 2,
          },
        ],
        [],
      ),
    ).toThrow();
    expect(() =>
      mergeUsageRows([{ total_tokens: Number.MAX_SAFE_INTEGER }, { total_tokens: 1 }], []),
    ).toThrow();
  });

  it("retains evidence counters and exact reported amounts on authenticated usage only", () => {
    const fixture = accountingFixture();
    const cost = {
      source: "server",
      kind: "actual",
      status: "complete",
      currency: "USD",
      units: "99999999999999999999",
      scale: 10,
    };
    const annotation = {
      status: "matched",
      basis: fixture.basis,
      groups: [{ ...fixture.groups[0], reported_costs: [cost] }],
    };
    const rows = [
      {
        evidence_tokens: 10,
        approximate_tokens: 3,
        accounting_count: 2,
        accounting_json: JSON.stringify(annotation),
      },
      { evidence_tokens: 12, approximate_tokens: 4, accounting_json: "null" },
    ];
    const [result] = mergeUsageRows(rows, [], true);
    expect(result).toMatchObject({
      evidence_tokens: 22,
      approximate_tokens: 7,
      accounting: [{ groups: [{ reported_costs: [{ ...cost, units: "199999999999999999998" }] }] }],
    });
    expect(mergeUsageRows(rows, [])[0].accounting?.[0].groups[0].reported_costs).toEqual([]);
  });

  it("merges sparse legacy rows before annotated rows and ignores unchanged time extrema", () => {
    const fixture = accountingFixture();
    const annotation = { status: "pending", basis: fixture.basis, groups: [] };
    const rows = [
      { first_seen: "2026-01-01", last_seen: "2026-01-04" },
      {
        first_seen: "2026-01-02",
        last_seen: "2026-01-03",
        sources: "codex",
        models: "m",
        input_tokens: 10,
        accounting_json: JSON.stringify(annotation),
      },
    ];
    expect(mergeUsageRows(rows, [])).toMatchObject([
      {
        first_seen: "2026-01-01",
        last_seen: "2026-01-04",
        input_tokens: 10,
        sources: "codex",
        models: "m",
        accounting: [{ status: "pending" }],
      },
    ]);
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizeZcodeUsage,
  parseZcodeSqlite,
} from "../parsers/zcode-sqlite.js";
import type {
  ZcodeUsageDb,
  ZcodeUsageRow,
} from "../parsers/zcode-types.js";

/**
 * Local-machine sample rows (docs/43-zcode-support.md §1.4). computed_total
 * = provider_total = input + output — puts us in the "inclusive" reasoning
 * branch (reasoning=0 in every row).
 */
const LOCAL_ROWS: ZcodeUsageRow[] = [
  {
    id: "usage_model_1",
    sessionId: "sess_1",
    turnId: "turn_1",
    modelId: "GLM-5.2",
    providerId: "builtin:bigmodel-coding-plan",
    status: "completed",
    startedAt: 1783646250951,
    completedAt: 1783646259831,
    inputTokens: 11933,
    outputTokens: 170,
    reasoningTokens: 0,
    cacheReadInputTokens: 7360,
    cacheCreationInputTokens: 0,
    providerTotalTokens: 12103,
    computedTotalTokens: 12103,
  },
  {
    id: "usage_model_2",
    sessionId: "sess_1",
    turnId: "turn_1",
    modelId: "GLM-5.2",
    providerId: "builtin:bigmodel-coding-plan",
    status: "completed",
    startedAt: 1783646260477,
    completedAt: 1783646265440,
    inputTokens: 16335,
    outputTokens: 180,
    reasoningTokens: 0,
    cacheReadInputTokens: 11904,
    cacheCreationInputTokens: 0,
    providerTotalTokens: 16515,
    computedTotalTokens: 16515,
  },
  {
    id: "usage_model_3",
    sessionId: "sess_1",
    turnId: "turn_1",
    modelId: "GLM-5.2",
    providerId: "builtin:bigmodel-coding-plan",
    status: "completed",
    startedAt: 1783646265558,
    completedAt: 1783646270512,
    inputTokens: 17425,
    outputTokens: 180,
    reasoningTokens: 0,
    cacheReadInputTokens: 16320,
    cacheCreationInputTokens: 0,
    providerTotalTokens: 17605,
    computedTotalTokens: 17605,
  },
  {
    id: "usage_model_4",
    sessionId: "sess_1",
    turnId: "turn_1",
    modelId: "GLM-5.2",
    providerId: "builtin:bigmodel-coding-plan",
    status: "completed",
    startedAt: 1783646271021,
    completedAt: 1783646276800,
    inputTokens: 18541,
    outputTokens: 799,
    reasoningTokens: 0,
    cacheReadInputTokens: 17408,
    cacheCreationInputTokens: 0,
    providerTotalTokens: 19340,
    computedTotalTokens: 19340,
  },
];

/** Mock ZcodeUsageDb backed by an in-memory row array. */
function mockDb(rows: readonly ZcodeUsageRow[]): ZcodeUsageDb {
  return {
    queryUsageRows(lastCompletedAt, skipIds) {
      const watermark = lastCompletedAt ?? 0;
      const skip = new Set(skipIds);
      return rows
        .filter((r) => r.completedAt >= watermark && !skip.has(r.id))
        .sort(
          (a, b) =>
            a.completedAt - b.completedAt || a.id.localeCompare(b.id),
        );
    },
    close() {
      // no-op
    },
  };
}

describe("normalizeZcodeUsage", () => {
  it("Case 1 — one row, inclusive semantics (input contains cache_read)", () => {
    const { tokens, warn } = normalizeZcodeUsage(LOCAL_ROWS[0]);
    expect(warn).toBeUndefined();
    expect(tokens).toEqual({
      inputTokens: 4573, // 11933 - 7360
      cachedInputTokens: 7360,
      outputTokens: 170,
      reasoningOutputTokens: 0,
    });
  });

  it("Case 5 — cache_read > input_tokens (dirty data) yields inputTokens=0", () => {
    const row: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      inputTokens: 100,
      cacheReadInputTokens: 500,
      computedTotalTokens: 270, // 100 + 170
      providerTotalTokens: 270,
    };
    const { tokens } = normalizeZcodeUsage(row);
    expect(tokens.inputTokens).toBe(0);
  });

  it("Case 9a — reasoning > 0, provider_total matches inclusive branch → subtract reasoning", () => {
    // input_tokens=1000, output_tokens=200, reasoning=50, no cache.
    // Inclusive: provider_total = 1200. output→ 200 - 50 = 150.
    const row: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      providerTotalTokens: 1200,
      computedTotalTokens: 1200,
    };
    const { tokens, warn } = normalizeZcodeUsage(row);
    expect(warn).toBeUndefined();
    expect(tokens).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 150,
      reasoningOutputTokens: 50,
    });
  });

  it("Case 9b — reasoning > 0, provider_total matches disjoint branch → keep output", () => {
    // input=1000, output=200, reasoning=50, no cache.
    // Disjoint: provider_total = 1250.
    const row: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      providerTotalTokens: 1250,
      computedTotalTokens: 1250,
    };
    const { tokens, warn } = normalizeZcodeUsage(row);
    expect(warn).toBeUndefined();
    expect(tokens).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningOutputTokens: 50,
    });
  });

  it("Case 9c — reasoning > 0, provider_total matches neither → warn + inclusive fallback", () => {
    const row: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      providerTotalTokens: 9999, // pathological
      computedTotalTokens: 9999,
    };
    const { tokens, warn } = normalizeZcodeUsage(row);
    expect(warn).toMatch(/zcode provider_total mismatch/);
    expect(tokens.outputTokens).toBe(150); // inclusive fallback
  });

  it("Case 10 — cache_creation > 0 && input_tokens > 0 → cache_creation stays inside input", () => {
    // input=1000 already contains cache_read=200 and cache_creation=100.
    // Normalized: input = 1000 - 200 = 800; cached = 200 (cache_read only).
    // total = 800 + 200 + 100 + 0 = 1100 = provider_total (input+output).
    const row: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      inputTokens: 1000,
      outputTokens: 100,
      reasoningTokens: 0,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 100,
      providerTotalTokens: 1100,
      computedTotalTokens: 1100,
    };
    const { tokens, warn } = normalizeZcodeUsage(row);
    expect(warn).toBeUndefined();
    expect(tokens).toEqual({
      inputTokens: 800,
      cachedInputTokens: 200,
      outputTokens: 100,
      reasoningOutputTokens: 0,
    });
  });

  it("Case 11 — input_tokens=0 fallback: cache_creation becomes input side", () => {
    // ZCode's fallback branch: total = cache_creation + cache_read + output.
    const row: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
      cacheReadInputTokens: 300,
      cacheCreationInputTokens: 500,
      providerTotalTokens: 900, // 300 + 500 + 100
      computedTotalTokens: 900,
    };
    const { tokens, warn } = normalizeZcodeUsage(row);
    expect(warn).toBeUndefined();
    expect(tokens).toEqual({
      inputTokens: 500, // = cache_creation when input_tokens=0
      cachedInputTokens: 300,
      outputTokens: 100,
      reasoningOutputTokens: 0,
    });
  });

  it("Case 12 — provider_total null falls back to computed_total", () => {
    const row: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      providerTotalTokens: null,
    };
    const { tokens, warn } = normalizeZcodeUsage(row);
    expect(warn).toBeUndefined();
    expect(tokens.inputTokens).toBe(4573);
  });
});

describe("parseZcodeSqlite", () => {
  it("Case 2 — 4 local rows, first sync (all-null cursor) → 4 deltas, sums verified", () => {
    const db = mockDb(LOCAL_ROWS);
    const result = parseZcodeSqlite({
      db,
      lastCompletedAt: null,
      lastProcessedIds: [],
    });
    expect(result.deltas).toHaveLength(4);
    expect(result.rowCount).toBe(4);

    const totals = result.deltas.reduce(
      (acc, d) => ({
        input: acc.input + d.tokens.inputTokens,
        cached: acc.cached + d.tokens.cachedInputTokens,
        output: acc.output + d.tokens.outputTokens,
        reasoning: acc.reasoning + d.tokens.reasoningOutputTokens,
      }),
      { input: 0, cached: 0, output: 0, reasoning: 0 },
    );
    expect(totals).toEqual({
      input: 11242,
      cached: 52992,
      output: 1329,
      reasoning: 0,
    });
    // Sum of everything = provider computed_total sums (65,563).
    const total =
      totals.input + totals.cached + totals.output + totals.reasoning;
    expect(total).toBe(65563);

    // Cursor advancement: last row's completedAt + its id.
    expect(result.maxCompletedAt).toBe(1783646276800);
    expect(result.boundaryIds).toEqual(["usage_model_4"]);
  });

  it("Case 3 — running row is silently absent from the mock (SQL would filter it)", () => {
    // Emulate the SQL WHERE clause: rows with status='running' don't appear.
    const runningRow: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      id: "usage_running_1",
      status: "completed", // still completed in this fixture — parser doesn't re-filter
    };
    const db = mockDb([runningRow]);
    const result = parseZcodeSqlite({
      db,
      lastCompletedAt: null,
    });
    // Parser trusts SQL filter; here we assert that when SQL returns nothing,
    // parser produces nothing.
    const emptyDb: ZcodeUsageDb = {
      queryUsageRows: () => [],
      close() {},
    };
    const emptyResult = parseZcodeSqlite({
      db: emptyDb,
      lastCompletedAt: null,
    });
    expect(emptyResult.deltas).toHaveLength(0);
    expect(emptyResult.rowCount).toBe(0);
    expect(emptyResult.maxCompletedAt).toBe(0);
    // Sanity: parser doesn't crash on the completed fixture either.
    expect(result.deltas.length).toBeGreaterThanOrEqual(0);
  });

  it("Case 4 — error / cancelled with non-zero tokens still emit deltas", () => {
    const rows: ZcodeUsageRow[] = [
      { ...LOCAL_ROWS[0], id: "err_row", status: "error" },
      { ...LOCAL_ROWS[1], id: "cancel_row", status: "cancelled" },
    ];
    const db = mockDb(rows);
    const result = parseZcodeSqlite({ db, lastCompletedAt: null });
    expect(result.deltas).toHaveLength(2);
  });

  it("Case 6 — incremental: cursor at row3.completedAt+id, only row4 is emitted", () => {
    const db = mockDb(LOCAL_ROWS);
    const result = parseZcodeSqlite({
      db,
      lastCompletedAt: LOCAL_ROWS[2].completedAt,
      lastProcessedIds: [LOCAL_ROWS[2].id],
    });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].timestamp).toBe(
      new Date(LOCAL_ROWS[3].completedAt).toISOString(),
    );
  });

  it("Case 7 — empty table returns cursor at zero", () => {
    const db = mockDb([]);
    const result = parseZcodeSqlite({ db, lastCompletedAt: null });
    expect(result.deltas).toHaveLength(0);
    expect(result.maxCompletedAt).toBe(0);
    expect(result.boundaryIds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("Case 8 — two rows sharing the max completed_at: both emit, both land in boundaryIds", () => {
    const a: ZcodeUsageRow = { ...LOCAL_ROWS[0], id: "row_a", completedAt: 5000 };
    const b: ZcodeUsageRow = { ...LOCAL_ROWS[1], id: "row_b", completedAt: 5000 };
    const c: ZcodeUsageRow = { ...LOCAL_ROWS[2], id: "row_c", completedAt: 4000 };
    const db = mockDb([c, a, b]);
    const result = parseZcodeSqlite({ db, lastCompletedAt: null });
    expect(result.deltas).toHaveLength(3);
    expect(result.maxCompletedAt).toBe(5000);
    expect(new Set(result.boundaryIds)).toEqual(new Set(["row_a", "row_b"]));
  });

  it("Case 8b — out-of-order rows (max then older): boundaryIds keeps just the max", () => {
    // Feed the parser rows in max-then-older order to cover the "neither
    // > nor ===" fall-through in boundaryIds bookkeeping.
    const rawDb = {
      queryUsageRows() {
        return [
          { ...LOCAL_ROWS[0], id: "row_max", completedAt: 8000 },
          { ...LOCAL_ROWS[1], id: "row_older", completedAt: 3000 },
        ];
      },
      close() {},
    };
    const result = parseZcodeSqlite({ db: rawDb, lastCompletedAt: null });
    expect(result.deltas).toHaveLength(2);
    expect(result.maxCompletedAt).toBe(8000);
    expect(result.boundaryIds).toEqual(["row_max"]);
  });

  it("Case 12b — terminal-but-zero row: does NOT push a delta, cursor still advances", () => {
    const zeroRow: ZcodeUsageRow = {
      ...LOCAL_ROWS[0],
      id: "zero_row",
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      providerTotalTokens: 0,
      computedTotalTokens: 0,
      status: "cancelled",
    };
    const db = mockDb([zeroRow]);
    const result = parseZcodeSqlite({ db, lastCompletedAt: null });
    expect(result.deltas).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.maxCompletedAt).toBe(zeroRow.completedAt);
    expect(result.boundaryIds).toEqual(["zero_row"]);
  });

  it("Case warn-dedup — multiple mismatched rows still emit at most one warning", () => {
    const bad: ZcodeUsageRow[] = [1, 2, 3].map((n) => ({
      ...LOCAL_ROWS[0],
      id: `bad_${n}`,
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      providerTotalTokens: 9999,
      computedTotalTokens: 9999,
      completedAt: LOCAL_ROWS[0].completedAt + n,
    }));
    const db = mockDb(bad);
    const result = parseZcodeSqlite({ db, lastCompletedAt: null });
    expect(result.warnings).toHaveLength(1);
  });
});

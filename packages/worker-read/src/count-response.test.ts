import { describe, expect, it } from "vitest";
import { checkedCountResponse } from "./count-response";

const reply = (body: unknown) => Promise.resolve(Response.json(body, { headers: { "x-test": "preserved" } }));

describe("exact count response boundary", () => {
  it.each(["total_tokens", "cached_input_tokens", "tokens_7d", "tokens_30d", "tokens_last_hour", "total_messages", "duration_seconds", "total_duration_seconds", "request_count", "totalTokens", "totalDurationSeconds", "callCount", "cacheReadInputTokens", "sourceRevision"])("fails closed for unsafe %s in nested results", async (field) => {
    const response = await checkedCountResponse(reply({ result: [{ nested: { [field]: Number.MAX_SAFE_INTEGER + 1 } }] }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Count exceeds supported integer range" });
  });

  it("preserves safe integer limits, null sums, exact-money strings and fractional prices", async () => {
    const body = { result: [{ total_tokens: Number.MAX_SAFE_INTEGER, total_duration_seconds: null,
      total_cost: 1.234567, input: 0.75, output: 3.25, average_duration: 1.5, avg_duration_seconds: 1.25, avgMessages: 2.5, units: "9".repeat(60),
      token_price: 0.00001, groups: [{ input_total_tokens: 900, cache_read_input_tokens: 800, cacheWriteInputTokens: 100 }] }] };
    const response = await checkedCountResponse(reply(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("preserved");
    expect(await response.json()).toEqual(body);
  });

  it.each([-1, 1.5, "9007199254740993"])("rejects invalid count values %s", async (value) => {
    expect((await checkedCountResponse(reply({ result: { total_tokens: value } }))).status).toBe(500);
  });

  it("passes scalar and non-count responses and existing error responses through", async () => {
    for (const result of [null, 0, true, "test", ["test"]]) {
      expect(await (await checkedCountResponse(reply({ result }))).json()).toEqual({ result });
    }
    const error = Response.json({ error: "Missing user" }, { status: 400 });
    expect(await checkedCountResponse(Promise.resolve(error))).toBe(error);
  });

  it("returns a safe error when SQLite SUM overflows or the query rejects asynchronously", async () => {
    const response = await checkedCountResponse(Promise.reject(new Error("integer overflow private-query")));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });
});

describe("native query results before JSON serialization", () => {
  it.each([Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid numeric results before JSON turns %s into null or rounded output", async (value) => {
    const { checkedCountDatabase } = await import("./count-response");
    const statement = { bind() { return this; }, async first() { return { accounting: [{ counts: { inputTotalTokens: value } }] }; }, async all() { return { results: [{ total_tokens: value }] }; } };
    const db = checkedCountDatabase({ prepare: () => statement } as unknown as D1Database);
    await expect(db.prepare("fixture").bind("id").first()).rejects.toThrow("Count exceeds supported integer range");
    await expect(db.prepare("fixture").all()).rejects.toThrow("Count exceeds supported integer range");
  });

  it("preserves native receivers and forwards unmodified safe results including prices", async () => {
    const { checkedCountDatabase } = await import("./count-response");
    const row = { total_tokens: 1000, price: 0.25, averageDurationSeconds: 1.5 };
    const statement = { async first(column?: string) { expect(this).toBe(statement); return column ? Reflect.get(row, column) : row; },
      async all() { expect(this).toBe(statement); return { results: [row], meta: { duration: 0.25 } }; },
      async raw() { expect(this).toBe(statement); return [[1000]]; }, marker: "statement" };
    const source = { prepare(query: string) { expect(this).toBe(source); expect(query).toBe("fixture"); return statement; },
      async exec() { expect(this).toBe(source); return "native"; }, marker: "database" };
    const db = checkedCountDatabase(source as unknown as D1Database);
    expect(await db.prepare("fixture").first()).toBe(row);
    expect(await db.prepare("fixture").first("total_tokens")).toBe(1000);
    expect(await db.prepare("fixture").first("price")).toBe(0.25);
    expect(await db.prepare("fixture").raw()).toEqual([[1000]]);
    expect(Reflect.get(db.prepare("fixture"), "marker")).toBe("statement");
    expect(Reflect.get(db, "marker")).toBe("database");
    expect(await db.prepare("fixture").all()).toEqual({ results: [row], meta: { duration: 0.25 } });
    expect(await db.exec("fixture")).toBe("native");
  });

  it("rejects unsafe named scalar first results", async () => {
    const { checkedCountDatabase } = await import("./count-response");
    const db = checkedCountDatabase({ prepare: () => ({ first: async () => Infinity }) } as unknown as D1Database);
    await expect(db.prepare("fixture").first("total_tokens")).rejects.toThrow("Count exceeds supported integer range");
  });
});

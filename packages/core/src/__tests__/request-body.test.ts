import { describe, expect, it, vi } from "vitest";
import { BodyTooLargeError, readBoundedBody, readBoundedJson } from "../request-body.js";

function streamed(chunks: Uint8Array[], length?: string, cancel = vi.fn()) {
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  return { request: new Request("https://test.invalid", { method: "POST", body, duplex: "half",
    headers: length === undefined ? {} : { "Content-Length": length } } as RequestInit), cancel };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("bounded request bodies", () => {
  it("accepts the byte limit exactly and decodes split UTF-8 only after reading", async () => {
    const data = bytes('["中"]');
    const { request } = streamed([data.subarray(0, 3), data.subarray(3)]);
    expect(await readBoundedJson(request, data.length)).toEqual(["中"]);
  });

  it.each([undefined, "1", "invalid"])("counts actual bytes even with Content-Length %s", async (length) => {
    const { request, cancel } = streamed([bytes("123"), bytes("45"), bytes("not read")], length);
    await expect(readBoundedBody(request, 4)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);
  });

  it("rejects an oversized declared length before pulling and cancels the body", async () => {
    const { request, cancel } = streamed([bytes("x")], "100");
    const getReader = vi.spyOn(request.body!, "getReader");
    await expect(readBoundedBody(request, 4)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps a safe limit error even if source cancellation rejects", async () => {
    const { request } = streamed([bytes("12345")], undefined, vi.fn().mockRejectedValue(new Error("private")));
    await expect(readBoundedBody(request, 4)).rejects.toThrow("Request body too large");
  });

  it("handles absent, empty, invalid JSON and failed streams", async () => {
    expect(await readBoundedBody(new Request("https://test.invalid"), 4)).toEqual(new Uint8Array());
    await expect(readBoundedJson(streamed([]).request, 4)).rejects.toBeInstanceOf(SyntaxError);
    await expect(readBoundedJson(streamed([bytes("x")]).request, 4)).rejects.toBeInstanceOf(SyntaxError);
    const { request } = streamed([bytes("123")]);
    await request.body?.cancel();
    expect(await readBoundedBody(request, 4)).toEqual(new Uint8Array());
    const failed = new Request("https://test.invalid", { method: "POST", body: new ReadableStream({
      start(controller) { controller.error(new Error("aborted")); },
    }), duplex: "half" } as RequestInit);
    await expect(readBoundedBody(failed, 4)).rejects.toThrow("aborted");
    expect(failed.body?.locked).toBe(false);
  });

  it("accumulates many small chunks without changing their content", async () => {
    const { request } = streamed(Array.from({ length: 5000 }, () => bytes("a")));
    expect(await readBoundedBody(request, 5000)).toEqual(bytes("a".repeat(5000)));
  });
});

describe("ingest payload budgets", () => {
  it("fits 25 detailed records with 256 maximally populated groups each", async () => {
    const { accountingFixture } = await import("../__test-helpers__/accounting.js");
    const { validateAccountingRecord } = await import("../accounting.js");
    const { MAX_ACCOUNTING_BODY_BYTES } = await import("../constants.js");
    const fixture = accountingFixture();
    const group = { ...fixture.groups[0], origin: "a".repeat(128), model: "a".repeat(128), provider: "a".repeat(128),
      route: "a".repeat(128), service_tier: "a".repeat(128),
      context_tokens_min: 1_000_000_000, context_tokens_max: 1_000_000_000, request_count: 100_000_000,
      reported_costs: Array(4).fill({ units: "9".repeat(60), scale: 18, currency: "USD", kind: "estimate", status: "complete", source: "a".repeat(128) }),
      diagnostics: Array(3).fill({ code: "aggregate_context", raw_total_tokens: 1_000_000_000 }) };
    const basis = Object.fromEntries(Object.entries(fixture.basis).map(([key, value]) => [key, value * 256]));
    const record = { ...fixture, model: "a".repeat(128), device_id: "a".repeat(128), basis, groups: Array(256).fill(group) };
    expect(validateAccountingRecord(record, 0).valid).toBe(true);
    const payload = JSON.stringify({ userId: "a".repeat(128), records: Array(25).fill(record) });
    expect(bytes(payload).length).toBeLessThan(MAX_ACCOUNTING_BODY_BYTES);
    const request = new Request("https://test.invalid", { method: "POST", body: payload });
    const parsed = await readBoundedJson(request, MAX_ACCOUNTING_BODY_BYTES) as { records: unknown[] };
    expect(parsed.records).toHaveLength(25);
    expect(validateAccountingRecord(parsed.records[24], 24).valid).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as tokens } from "@/app/api/ingest/route";
import { POST as sessions } from "@/app/api/ingest/sessions/route";
import { POST as evidence } from "@/app/api/ingest/evidence/route";
import { POST as details } from "@/app/api/ingest/details/route";
import { resolveUser } from "@/lib/auth-helpers";
import { inMemoryRateLimiter } from "@/lib/rate-limit";
import { accountingFixture } from "../../../core/src/__test-helpers__/accounting";

vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));
beforeEach(() => {
  inMemoryRateLimiter.reset();
  vi.mocked(resolveUser).mockResolvedValue({ userId: "test-user" });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const handlers = [["tokens", tokens, 1024 * 1024], ["sessions", sessions, 1024 * 1024],
  ["evidence", evidence, 1024 * 1024], ["details", details, 24 * 1024 * 1024]] as const;

describe("ingest request budgets", () => {
  it.each(handlers)("rejects and cancels oversized streamed %s before forwarding", async (_name, handler, limit) => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(limit + 1)); }, cancel });
    const request = new Request("https://test.invalid", { method: "POST", body, duplex: "half",
      headers: { "X-Pew-Client-Version": "3.0.0", "Content-Length": "1" } } as RequestInit);
    const response = await handler(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enforces the existing 25-record details batch before proxying", async () => {
    const response = await details(new Request("https://test.invalid", { method: "POST",
      headers: { "X-Pew-Client-Version": "3.0.0" }, body: JSON.stringify(Array(26).fill(accountingFixture())) }));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ingest/details/route";
import { inMemoryRateLimiter } from "@/lib/rate-limit";
import { resolveUser } from "@/lib/auth-helpers";
import { accountingFixture } from "../../../core/src/__test-helpers__/accounting";

vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));
const r = accountingFixture();
const request = () => new Request("https://synthetic.invalid/api/ingest/details", { method: "POST", headers: { "X-Pew-Client-Version": "2.29.5" }, body: JSON.stringify([r]) });
beforeEach(() => { inMemoryRateLimiter.reset(); vi.mocked(resolveUser).mockResolvedValue({ userId: "synthetic-user" }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("accounting proxy receipts", () => {
  it("does not substitute HTTP success for a compatible receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ingested: 1 })));
    expect((await POST(request())).status).toBe(502);
  });
  it("projects explicit per-record receipts and discards arbitrary upstream data", async () => {
    const receipt = { key: JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]), source_revision: 1, parser_revision: 1, detail_revision: 1, status: "base_mismatch" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ details_version: 1, acknowledgments: [receipt], secret: "PRIVATE" })));
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ details_version: 1, acknowledgments: [receipt] });
  });
});

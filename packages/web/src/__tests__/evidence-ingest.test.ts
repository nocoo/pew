import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_CLIENT_VERSION } from "@pew/core";
import { POST } from "@/app/api/ingest/evidence/route";
import { resolveUser } from "@/lib/auth-helpers";

vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));
const record = { source: "hermes", model: "test-model", device_id: "test-device", timestamp: "2026-09-06T16:00:00.000Z",
  hour_start: "2026-09-06T16:00:00.000Z", input_tokens: 10, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 11,
  evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "approval", origin: "hermes-acp-ledger", provider: "openai",
    granularity: "session", timePrecision: "session-start", intervalStart: null, intervalEnd: null, callCount: 1, snapshotSeq: 1 } };
const request = (rows: unknown[] = [record]) => new Request("https://synthetic.invalid/api/ingest/evidence", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Pew-Client-Version": MIN_CLIENT_VERSION }, body: JSON.stringify(rows),
});

describe("evidence web ingest boundary", () => {
  const fetch = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("WORKER_INGEST_URL", "https://synthetic-worker.invalid/ingest");
    vi.stubEnv("WORKER_SECRET", "synthetic-test-secret");
    vi.mocked(resolveUser).mockResolvedValue({ userId: "synthetic-user", email: "synthetic@example.invalid" });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("uses the authenticated owner and separate evidence URL with an unchanged record", async () => {
    fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect((await POST(request())).status).toBe(200);
    const call = fetch.mock.calls[0];
    if (!call) throw new Error("Expected a synthetic worker request");
    const [url, options] = call;
    expect(url).toBe("https://synthetic-worker.invalid/ingest/evidence");
    expect(JSON.parse(options.body)).toEqual({ userId: "synthetic-user", records: [record] });
  });

  it("rejects unauthenticated callers and private fields without forwarding", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    const res = await POST(request([{ ...record, prompt: "PRIVATE_FIXTURE_BODY" }]));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("PRIVATE_FIXTURE_BODY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps upstream error bodies and transport exceptions out of logs and responses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const kind of ["response", "transport"]) {
      if (kind === "response") fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "PRIVATE_FIXTURE_BODY" }), { status: 500 }));
      else fetch.mockRejectedValueOnce(new Error("PRIVATE_FIXTURE_BODY"));
      const res = await POST(request());
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("PRIVATE_FIXTURE_BODY");
      expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("PRIVATE_FIXTURE_BODY");
    }
  });
});

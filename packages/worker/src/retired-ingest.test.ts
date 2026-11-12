import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";
import { accountingFixture } from "../../core/src/__test-helpers__/accounting";

const retired = ["gemini-cli", "kosmos", "omp", "zcode", "pmstudio", "vscode-copilot"];
const routes = ["/ingest", "/ingest/tokens", "/ingest/sessions", "/ingest/evidence", "/ingest/details"];
const token = { source: "codex", model: "gpt-6-astra", hour_start: "2026-09-01T00:00:00.000Z", input_tokens: 100,
  cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 };
const session = { source: "codex", session_key: "codex:synthetic", kind: "human", started_at: "2026-09-01T00:00:00.000Z",
  last_message_at: "2026-09-01T00:01:00.000Z", duration_seconds: 60, user_messages: 1, assistant_messages: 1,
  total_messages: 2, project_ref: null, model: "gpt-6-astra", snapshot_at: "2026-09-01T00:01:00.000Z" };
const event = { ...token, source: "hermes", device_id: "synthetic-device", timestamp: token.hour_start,
  evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "approval", origin: "hermes-acp-ledger", provider: "openai",
    granularity: "call", timePrecision: "exact", intervalStart: null, intervalEnd: null, callCount: 1, snapshotSeq: 1 } };
function env(): Env {
  return { WORKER_SECRET: "test", DB: { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({}) }),
    batch: vi.fn().mockResolvedValue([]) } as unknown as D1Database };
}
const request = (path: string, records: unknown[], secret = "test", userId: unknown = "synthetic-user") => new Request(`https://synthetic.invalid${path}`, {
  method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ userId, records }),
});
const ack = (r: ReturnType<typeof accountingFixture>, status = "superseded") => ({
  key: JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]),
  source_revision: r.source_revision, parser_revision: r.parser_revision, detail_revision: r.detail_revision, status,
});

describe("Worker retired source defense", () => {
  it.each(routes)("discards all retired records on %s without touching D1 or logging payloads", async (path) => {
    const e = env();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await worker.fetch(request(path, retired.map((source) => ({ source, input_tokens: -1, prompt: "PRIVATE" }))), e);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(path.endsWith("details")
        ? { details_version: 1, acknowledgments: [], ingested: 0, ignored: 6 } : { ingested: 0, ignored: 6 });
      expect(e.DB.prepare).not.toHaveBeenCalled();
      expect(e.DB.batch).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("persists only the active partition in mixed token batches", async () => {
    const e = env();
    const response = await worker.fetch(request("/ingest/tokens", [{ source: "zcode", private: "PRIVATE" }, token]), e);
    expect(await response.json()).toEqual({ ingested: 1, ignored: 1 });
    expect(e.DB.prepare).toHaveBeenCalledOnce();
    expect(e.DB.batch).toHaveBeenCalledWith([{}]);
  });

  it.each([["/ingest/sessions", session], ["/ingest/evidence", event]] as const)("persists only active records on %s", async (path, active) => {
    const e = env();
    const response = await worker.fetch(request(path, [{ source: "zcode", private: "PRIVATE" }, active]), e);
    expect(await response.json()).toEqual({ ingested: 1, ignored: 1 });
    expect(e.DB.prepare).toHaveBeenCalledOnce();
    expect(e.DB.batch).toHaveBeenCalledWith([{}]);
  });

  it.each(routes)("enforces auth, envelope and original batch limits before filtering on %s", async (path) => {
    const e = env();
    const rows = [{ source: "kosmos" }];
    expect((await worker.fetch(request(path, rows, "wrong"), e)).status).toBe(401);
    expect((await worker.fetch(request(path, rows, "test", ""), e)).status).toBe(400);
    expect((await worker.fetch(request(path, Array(path.endsWith("details") ? 26 : 51).fill(rows[0])), e)).status).toBe(400);
    expect(e.DB.prepare).not.toHaveBeenCalled();
    expect(e.DB.batch).not.toHaveBeenCalled();
  });

  it.each(routes)("rejects invalid active and unknown records atomically on %s", async (path) => {
    const e = env();
    for (const record of [{ source: "unknown" }, { source: "codex", input_tokens: -1 }, ["gemini-cli"], null]) {
      expect((await worker.fetch(request(path, [{ source: "pmstudio" }, record]), e)).status).toBe(400);
    }
    expect(e.DB.prepare).not.toHaveBeenCalled();
    expect(e.DB.batch).not.toHaveBeenCalled();
  });

  it("returns terminal accounting receipts for retired identities without persisting unvalidated details", async () => {
    const e = env();
    const r = { ...accountingFixture(), source: "gemini-cli" };
    const response = await worker.fetch(request("/ingest/details", [{ ...r, basis: null, groups: "PRIVATE" }]), e);
    expect(await response.json()).toEqual({ details_version: 1, acknowledgments: [ack(r)], ingested: 0, ignored: 1 });
    expect(e.DB.prepare).not.toHaveBeenCalled();
    expect(e.DB.batch).not.toHaveBeenCalled();
  });

  it("returns no success receipt if the evidence transaction fails", async () => {
    const e = env();
    vi.mocked(e.DB.batch).mockRejectedValueOnce(new Error("D1_ERROR: PRIVATE table"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await worker.fetch(request("/ingest/evidence", [event]), e);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      // The evidence path must not echo bound values, source identifiers or
      // the driver message into its log line.
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls.flat().join(" ")).not.toContain("PRIVATE");
    } finally { log.mockRestore(); }
  });

  it("interleaves retired and applied accounting acknowledgments in original order", async () => {
    const e = env();
    const active = accountingFixture();
    const first = { ...active, source: "gemini-cli" };
    const last = { ...active, source: "omp" };
    vi.mocked(e.DB.batch).mockResolvedValueOnce([
      { results: [{ source_revision: 1 }], success: true, meta: {} },
      { results: [{ ...active.basis, evidence_snapshot_seq: null, base_matches: 1 }], success: true, meta: {} },
    ] as D1Result[]);
    const response = await worker.fetch(request("/ingest/details", [first, active, last]), e);
    expect(await response.json()).toEqual({ details_version: 1, acknowledgments: [ack(first), ack(active, "applied"), ack(last)], ingested: 1, ignored: 2 });
    expect(e.DB.prepare).toHaveBeenCalledTimes(2);
  });

  it("returns no success receipt if the mixed accounting transaction fails", async () => {
    const e = env();
    vi.mocked(e.DB.batch).mockRejectedValueOnce(new Error("PRIVATE"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await worker.fetch(request("/ingest/details", [{ ...accountingFixture(), source: "omp" }, accountingFixture()]), e);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(log.mock.calls.flat().join(" ")).not.toContain("PRIVATE");
    } finally { log.mockRestore(); }
  });
});

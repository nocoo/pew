import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_CLIENT_VERSION } from "@pew/core";
import { POST as tokens } from "@/app/api/ingest/route";
import { POST as sessions } from "@/app/api/ingest/sessions/route";
import { POST as evidence } from "@/app/api/ingest/evidence/route";
import { POST as details } from "@/app/api/ingest/details/route";
import { resolveUser } from "@/lib/auth-helpers";
import { inMemoryRateLimiter } from "@/lib/rate-limit";
import { accountingFixture } from "../../../core/src/__test-helpers__/accounting";

vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));
const retired = ["gemini-cli", "kosmos", "omp", "zcode", "pmstudio", "vscode-copilot"];
const handlers = [
  ["tokens", tokens],
  ["sessions", sessions],
  ["evidence", evidence],
] as const;
const token = {
  source: "codex",
  model: "gpt-6-astra",
  hour_start: "2026-09-01T00:00:00.000Z",
  input_tokens: 100,
  cached_input_tokens: 0,
  output_tokens: 10,
  reasoning_output_tokens: 0,
  total_tokens: 110,
};
const session = {
  source: "codex",
  session_key: "codex:synthetic",
  kind: "human",
  started_at: "2026-09-01T00:00:00.000Z",
  last_message_at: "2026-09-01T00:01:00.000Z",
  duration_seconds: 60,
  user_messages: 1,
  assistant_messages: 1,
  total_messages: 2,
  project_ref: null,
  model: "gpt-6-astra",
  snapshot_at: "2026-09-01T00:01:00.000Z",
};
const event = {
  ...token,
  source: "hermes",
  device_id: "synthetic-device",
  timestamp: token.hour_start,
  evidence: {
    eventId: "a".repeat(64),
    groupId: "b".repeat(64),
    callType: "approval",
    origin: "hermes-acp-ledger",
    provider: "openai",
    granularity: "call",
    timePrecision: "exact",
    intervalStart: null,
    intervalEnd: null,
    callCount: 1,
    snapshotSeq: 1,
  },
};
const request = (rows: unknown[], version = MIN_CLIENT_VERSION) =>
  new Request("https://synthetic.invalid", {
    method: "POST",
    headers: { "X-Pew-Client-Version": version },
    body: JSON.stringify(rows),
  });
const ack = (r: ReturnType<typeof accountingFixture>, status = "superseded") => ({
  key: JSON.stringify([r.device_id, r.source, r.model, r.hour_start, r.event_id]),
  source_revision: r.source_revision,
  parser_revision: r.parser_revision,
  detail_revision: r.detail_revision,
  status,
});

beforeEach(() => {
  inMemoryRateLimiter.reset();
  vi.mocked(resolveUser).mockResolvedValue({ userId: "synthetic-user" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ingested: 1 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("retired source ingress", () => {
  it.each(handlers)(
    "silently ignores all six retired %s sources before record validation",
    async (_name, handler) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await handler(
        request(retired.map((source) => ({ source, input_tokens: -1, prompt: "PRIVATE" }))),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ingested: 0, ignored: 6 });
      expect(fetch).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("only forwards active records from mixed token batches", async () => {
    const response = await tokens(
      request([{ source: "gemini-cli", private: "PRIVATE" }, token, { source: "omp" }]),
    );
    expect(await response.json()).toEqual({ ingested: 1, ignored: 2 });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({
      userId: "synthetic-user",
      records: [token],
    });
  });

  it.each([
    ["sessions", sessions, session],
    ["evidence", evidence, event],
  ] as const)(
    "only forwards active %s records from mixed batches",
    async (_name, handler, active) => {
      const response = await handler(request([{ source: "zcode", private: "PRIVATE" }, active]));
      expect(await response.json()).toEqual({ ingested: 1, ignored: 1 });
      expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).records).toEqual([
        active,
      ]);
    },
  );

  it.each([...handlers, ["details", details]] as const)(
    "keeps auth, version and batch checks ahead of retired %s filtering",
    async (_name, handler) => {
      const rows = [{ source: "zcode" }];
      vi.mocked(resolveUser).mockResolvedValueOnce(null);
      expect((await handler(request(rows))).status).toBe(401);
      expect((await handler(request(rows, "1.0.0"))).status).toBe(400);
      expect((await handler(request(Array(51).fill(rows[0])))).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rate limits retired requests instead of treating them as an unauthenticated bypass", async () => {
    vi.spyOn(inMemoryRateLimiter, "check").mockReturnValueOnce({
      allowed: false,
      retryAfter: 60,
      current: 300,
      limit: 300,
    });
    expect((await tokens(request([{ source: "omp" }]))).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(handlers)(
    "still rejects unknown and invalid active %s records atomically",
    async (_name, handler) => {
      for (const record of [
        { source: "unknown" },
        { source: "codex", input_tokens: -1 },
        ["gemini-cli"],
        null,
      ]) {
        expect((await handler(request([{ source: "kosmos" }, record]))).status).toBe(400);
      }
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("acknowledges valid retired accounting identities without validating or persisting counters", async () => {
    const r = { ...accountingFixture(), source: "pmstudio" };
    const response = await details(
      request([{ ...r, basis: { private: "PRIVATE" }, groups: null, prompt: "PRIVATE" }]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      details_version: 1,
      acknowledgments: [ack(r)],
      ingested: 0,
      ignored: 1,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps mixed accounting receipts in original order while only forwarding active identities", async () => {
    const active = accountingFixture();
    const first = { ...active, source: "gemini-cli" };
    const last = { ...active, source: "vscode-copilot" };
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ details_version: 1, acknowledgments: [ack(active, "applied")] }),
    );
    const response = await details(request([first, active, last]));
    expect(await response.json()).toEqual({
      details_version: 1,
      acknowledgments: [ack(first), ack(active, "applied"), ack(last)],
      ingested: 1,
      ignored: 2,
    });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).records).toEqual([
      active,
    ]);
  });

  it("ignores malformed retired accounting without echoing unsafe identifiers", async () => {
    const response = await details(request([{ source: "omp", model: "sk-PRIVATE" }]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      details_version: 1,
      acknowledgments: [],
      ingested: 0,
      ignored: 1,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not acknowledge retired accounting when the active transaction fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "PRIVATE" }, { status: 500 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await details(
      request([{ ...accountingFixture(), source: "omp" }, accountingFixture()]),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to ingest accounting details" });
    expect(log.mock.calls.flat().join(" ")).not.toContain("PRIVATE");
  });

  it("checks the accounting batch limit before discarding retired details", async () => {
    expect((await details(request(Array(26).fill({ source: "omp" })))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

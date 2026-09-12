import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHermesSqliteTokenDriver } from "../drivers/token/hermes-token-driver.js";
import { toEvidenceRecord } from "../utils/usage-evidence.js";
import type { ParsedDelta } from "../parsers/claude.js";
import type { EvidenceRecord } from "@pew/core";
import * as reviewLogs from "../parsers/hermes-review.js";
import { collectHermesUsageEvidence } from "../parsers/hermes-usage-evidence.js";

const epoch = (time: string) => Date.parse(time) / 1000;
const main = { id: "synthetic-session", model: "main-model", input_tokens: 1000, output_tokens: 100,
  cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, started_at: epoch("2026-09-06T00:00:00Z") };
const aux = { session_id: main.id, model: "review-model", billing_provider: "openai", route_key: "c".repeat(64),
  task: "background_review", input_tokens: 300, output_tokens: 30, cache_read_tokens: 0, cache_write_tokens: 0,
  reasoning_tokens: 0, api_call_count: 2, first_seen: epoch("2026-09-06T16:03:00Z"),
  last_seen: epoch("2026-09-06T16:03:00Z"), started_at: main.started_at, source: "cli" };
const api = (call: number, minute: string, input: number, output: number, id: string) =>
  `2026-09-06 16:${minute}:00,000 INFO [${main.id}] agent.conversation_loop: API call #${call}: model=review-model provider=openai in=${input} out=${output} total=${input + output} latency=1.0s id=${id}`;
const complete = (minute = "03", calls = 2, input = 300, output = 30) =>
  `2026-09-06 16:${minute}:00,000 INFO [${main.id}] agent.background_review: Background review complete: thread=bg-review calls=${calls} in=${input} out=${output} cache_read=0 result=none`;
const log = [api(1, "01", 100, 10, "synthetic-response-1"), api(2, "02", 200, 20, "synthetic-response-2"), complete()];
const total = (deltas: ParsedDelta[]) => deltas.reduce((n, d) => n + Object.values(d.tokens).reduce((a, b) => a + b, 0), 0);

describe("Hermes background review usage", () => {
  let dir: string;
  let dbPath: string;
  let rows: typeof aux[];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-hermes-review-"));
    dbPath = join(dir, "state.db");
    await writeFile(dbPath, "synthetic DI database");
    await mkdir(join(dir, "logs"));
    rows = [{ ...aux }];
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });
  const driver = (dbKey = "default") => createHermesSqliteTokenDriver({ dbPath, dbKey, logUtcOffsetMinutes: 0,
    openHermesDb: () => ({ querySessions: () => [main], queryAuxiliaryUsage: () => rows, close() {} }) });
  const writeLog = (lines: string[], suffix = "") => writeFile(join(dir, "logs", `agent.log${suffix}`), `${lines.join("\n")}\n`);
  const saved = (deltas: ParsedDelta[]): EvidenceRecord[] => deltas.filter((d) => d.evidence).map((d) => toEvidenceRecord(d, "test-device"));

  it("joins a uniquely verified review sequence to real call completion times, leaving main totals alone", async () => {
    await writeLog([log[0], log[1], api(41, "02", 900, 90, "main-call"), log[2],
      "2026-09-06 16:04:00,000 INFO [synthetic-session] agent.conversation_loop: PRIVATE_FIXTURE_BODY"]);
    const result = await driver().run(undefined, {});
    expect(total(result.deltas.filter((d) => !d.evidence))).toBe(1100);
    const extra = result.deltas.filter((d) => d.evidence);
    expect(total(extra)).toBe(330);
    expect(extra.filter((d) => d.evidence?.timePrecision === "exact")).toMatchObject([
      { timestamp: "2026-09-06T16:01:00.000Z", model: "review-model", evidence: { callType: "background_review", callCount: 1 } },
      { timestamp: "2026-09-06T16:02:00.000Z", model: "review-model", evidence: { callType: "background_review", callCount: 1 } },
    ]);
    expect(JSON.stringify(result.deltas)).not.toContain("PRIVATE_FIXTURE_BODY");
    expect(JSON.stringify(extra)).not.toContain("synthetic-response");
    expect(JSON.stringify(extra)).not.toContain(main.id);
  });

  it("deduplicates rotated log copies and survives cursor reset with logs gone", async () => {
    await writeLog(log);
    await writeLog(log, ".1");
    const first = await driver().run(undefined, {});
    expect(total(first.deltas.filter((d) => d.evidence))).toBe(330);
    await rm(join(dir, "logs"), { recursive: true });
    const replay = await driver().run(undefined, { evidenceRecords: saved(first.deltas) });
    expect(replay.deltas.filter((d) => d.evidence)).toEqual([]);
    expect(total(replay.deltas)).toBe(1100);
  });

  it.each([
    [log[0], complete()],
    [log[0], log[1]],
    [log[0], log[1], api(1, "01", 100, 10, "ambiguous-1"), api(2, "02", 200, 20, "ambiguous-2"), complete()],
    [log[0], log[1], complete("03", 2, 999, 30)],
  ].map((lines) => ({ lines })))("retains reliable DB totals with session-start precision when logs are incomplete or ambiguous (#%#)", async ({ lines }) => {
    await writeLog(lines);
    const extra = (await driver().run(undefined, {})).deltas.filter((d) => d.evidence);
    expect(total(extra)).toBe(330);
    expect(extra.every((d) => d.evidence?.timePrecision === "session-start")).toBe(true);
    expect(extra[0].timestamp).toBe("2026-09-06T00:00:00.000Z");
  });

  it("does not reassign already-accounted historical totals when late logs appear", async () => {
    const first = await driver().run(undefined, {});
    expect(total(first.deltas.filter((d) => d.evidence))).toBe(330);
    await writeLog(log);
    const replay = await driver().run(first.cursor, { evidenceRecords: saved(first.deltas) });
    expect(replay.deltas).toEqual([]);
  });

  it("captures later exact calls while preserving the historical allocation and ignoring stale DB snapshots", async () => {
    const first = await driver().run(undefined, {});
    const previous = saved(first.deltas);
    rows = [{ ...aux, input_tokens: 350, output_tokens: 35, api_call_count: 3, last_seen: epoch("2026-09-06T16:07:00Z") }];
    await writeLog([...log, api(1, "06", 50, 5, "new-review"), complete("07", 1, 50, 5)]);
    const next = await driver().run(first.cursor, { evidenceRecords: previous });
    expect(total(next.deltas.filter((d) => d.evidence?.timePrecision === "exact"))).toBe(55);
    const latest = new Map([...previous, ...saved(next.deltas)].map((r) => [r.evidence.eventId, r]));
    expect([...latest.values()].reduce((n, r) => n + r.total_tokens, 0)).toBe(385);
    rows = [{ ...aux }];
    expect((await driver().run(first.cursor, { evidenceRecords: [...latest.values()] })).deltas).toEqual([]);
  });

  it("does not match ambiguous billing routes or share a profile's accounting identity", async () => {
    await writeLog(log);
    rows = [aux, { ...aux, route_key: "d".repeat(64) }];
    const first = (await driver().run(undefined, {})).deltas.filter((d) => d.evidence);
    expect(total(first)).toBe(660);
    expect(first.every((d) => d.evidence?.timePrecision === "session-start")).toBe(true);
    rows = [aux];
    const a = saved((await driver().run(undefined, {})).deltas);
    const b = saved((await driver("profiles/cherry").run(undefined, { evidenceRecords: a })).deltas);
    expect(b.some((r) => a.some((p) => p.evidence.eventId === r.evidence.eventId))).toBe(false);
    expect(b.reduce((n, r) => n + r.total_tokens, 0)).toBe(330);
  });

  it("still captures the authoritative ledger if an API log cannot be read", async () => {
    vi.spyOn(reviewLogs, "readHermesReviewCalls").mockRejectedValueOnce(new Error("PRIVATE_FIXTURE_BODY"));
    const result = await driver().run(undefined, {});
    expect(total(result.deltas.filter((d) => d.evidence))).toBe(330);
    expect(total(result.deltas.filter((d) => !d.evidence))).toBe(1100);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FIXTURE_BODY");
  });

  it("never infers per-call reasoning from a log that does not contain it", async () => {
    rows = [{ ...aux, input_tokens: 90, output_tokens: 20, cache_read_tokens: 40, cache_write_tokens: 10,
      reasoning_tokens: 5, api_call_count: 1 }];
    await writeLog([
      `${api(1, "01", 140, 20, "opaque==")} cache=40/140 (29%) write=10`,
      complete("03", 1, 90, 20).replace("cache_read=0", "cache_read=40"),
    ]);
    const extra = (await driver().run(undefined, {})).deltas.filter((d) => d.evidence);
    expect(total(extra)).toBe(165); // Preserve Hermes' existing four-counter convention.
    expect(extra.filter((d) => d.evidence?.timePrecision === "exact")).toMatchObject([
      { tokens: { inputTokens: 90, cachedInputTokens: 50, outputTokens: 20, reasoningOutputTokens: 0 } },
    ]);
    expect(extra.find((d) => d.evidence?.timePrecision === "session-start")?.tokens.reasoningOutputTokens).toBe(5);
  });

  it("rejects corrupt or decreasing cumulative counters even with a newer source timestamp", () => {
    const collect = (overrides: Partial<typeof aux>, previous: EvidenceRecord[] = []) =>
      collectHermesUsageEvidence({ dbKey: "default", rows: [{ ...aux, ...overrides }], calls: [], previous });
    const previous = saved(collect({}));
    expect(collect({ input_tokens: Number.NaN })).toEqual([]);
    expect(collect({ output_tokens: -1 })).toEqual([]);
    expect(collect({ input_tokens: 299, last_seen: aux.last_seen + 60 }, previous)).toEqual([]);
    expect(collect({ api_call_count: 1, last_seen: aux.last_seen + 60 }, previous)).toEqual([]);
  });

  it("marks missing source times as unattributed and replays a deterministic counter revision", () => {
    const row = { ...aux, started_at: null, first_seen: null, last_seen: null };
    const first = collectHermesUsageEvidence({ dbKey: "default", rows: [row], calls: [], previous: [] });
    expect(first).toMatchObject([{ timestamp: "1970-01-01T00:00:00.000Z", evidence: {
      timePrecision: "unattributed", intervalEnd: null,
    } }]);
    expect(total(first)).toBe(330);
    expect(collectHermesUsageEvidence({ dbKey: "default", rows: [row], calls: [], previous: saved(first) })).toEqual([]);
    const withFirstSeen = collectHermesUsageEvidence({ dbKey: "default", rows: [{ ...row, first_seen: aux.first_seen }], calls: [], previous: [] });
    expect(withFirstSeen[0]).toMatchObject({ timestamp: "2026-09-06T16:03:00.000Z", evidence: { timePrecision: "unattributed" } });
  });

  it("isolates an auxiliary query failure from main session accounting and redacts its error", async () => {
    const isolated = createHermesSqliteTokenDriver({ dbPath, dbKey: "default",
      openHermesDb: () => ({ querySessions: () => [main], queryAuxiliaryUsage() { throw new Error("PRIVATE_FIXTURE_BODY"); }, close() {} }) });
    const result = await isolated.run(undefined, {});
    expect(total(result.deltas)).toBe(1100);
    expect(result.warnings).toEqual(["Hermes auxiliary evidence unavailable; main session accounting preserved"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FIXTURE_BODY");
  });
});

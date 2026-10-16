import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorkbuddyFile } from "../parsers/workbuddy.ts";
import { buildWorkbuddySessionSnapshots, collectWorkbuddySessions } from "../parsers/workbuddy-session.ts";
import { MAX_RECORD_MESSAGES, MAX_RECORD_TOKENS, MAX_SESSION_DURATION_SECONDS } from "@pew/core";

const YEAR_0001 = Date.parse("0001-01-01T00:00:00Z");
const YEAR_9999 = Date.parse("9999-12-31T23:59:59Z");

// The server rejects token fields over MAX_RECORD_TOKENS and session
// durations over MAX_SESSION_DURATION_SECONDS with a 400, and the upload
// engine does not retry a 4xx — one such record wedges every later upload
// for the account. Antigravity gates these at the parser (its precedent);
// workbuddy must do the same instead of queueing an un-uploadable record.

function usageRow(raw: Record<string, unknown>): string {
  return JSON.stringify({
    type: "message", timestamp: 1757491200000,
    providerData: { model: "m", messageId: "M1", rawUsage: raw },
  }) + "\n";
}

describe("workbuddy parser enforces the server's record limits locally", () => {
  it("drops a token row whose single field exceeds MAX_RECORD_TOKENS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-cap-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [
      usageRow({ prompt_tokens: MAX_RECORD_TOKENS + 1, prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: MAX_RECORD_TOKENS + 1, completion_tokens: 0, total_tokens: MAX_RECORD_TOKENS + 1 }),
      usageRow({ prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10,
        completion_tokens: 0, total_tokens: 10 }),
      "",
    ].join("\n"));
    const r = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]!.tokens.inputTokens).toBe(10);
  });

  it("drops a token row whose alias-composed buckets exceed MAX_RECORD_TOKENS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-cap-"));
    const file = join(dir, "s.jsonl");
    // Each individual bucket stays under the cap, but the request total is
    // what the server's accounting invariant sums — compose a row whose
    // buckets just clear the per-field gate while their sum crosses it, so
    // only an aggregate-level check can catch it. Simplest such shape: two
    // rows for the same bucket key (model + hour) that each pass the
    // per-field gate but sum over it; the parser can't see bucket sums, so
    // this test asserts the per-field gate on the composed buckets instead —
    // an alias misread that makes one bucket cross the cap even though every
    // raw counter is under it.
    writeFileSync(file, [
      usageRow({ prompt_tokens: 10, prompt_cache_hit_tokens: 900_000_000,
        prompt_cache_miss_tokens: 10, completion_tokens: 1_000_000_001, total_tokens: 1_000_000_011 }),
      "",
    ].join("\n"));
    const r = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.deltas).toEqual([]);
  });

  it("keeps a row sitting exactly at MAX_RECORD_TOKENS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-cap-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [
      usageRow({ prompt_tokens: MAX_RECORD_TOKENS, prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: MAX_RECORD_TOKENS, completion_tokens: 0, total_tokens: MAX_RECORD_TOKENS }),
      "",
    ].join("\n"));
    const r = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.deltas).toHaveLength(1);
  });

  it("drops a session whose duration exceeds MAX_SESSION_DURATION_SECONDS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-cap-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [
      JSON.stringify({ sessionId: "ses-1", type: "message", role: "assistant", timestamp: YEAR_0001, message: { model: "m" } }) + "\n",
      JSON.stringify({ sessionId: "ses-1", type: "message", role: "assistant", timestamp: YEAR_9999, message: { model: "m" } }) + "\n",
      "",
    ].join("\n"));
    const snaps = await collectWorkbuddySessions(file);
    rmSync(dir, { recursive: true, force: true });
    expect(snaps).toEqual([]);
  });

  it("keeps a session whose duration sits exactly at the cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-cap-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [
      JSON.stringify({ sessionId: "ses-1", type: "message", role: "assistant", timestamp: 0, message: { model: "m" } }) + "\n",
      JSON.stringify({ sessionId: "ses-1", type: "message", role: "assistant", timestamp: MAX_SESSION_DURATION_SECONDS * 1000, message: { model: "m" } }) + "\n",
      "",
    ].join("\n"));
    const snaps = await collectWorkbuddySessions(file);
    rmSync(dir, { recursive: true, force: true });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.durationSeconds).toBe(MAX_SESSION_DURATION_SECONDS);
  });

  it("drops a session whose message count exceeds MAX_RECORD_MESSAGES", () => {
    // The server rejects message counts over MAX_RECORD_MESSAGES with a 400
    // and the upload engine does not retry a 4xx — a corrupted file with an
    // absurd count would wedge every later session upload. 1e8 lines is not
    // writable in a test, so the gate runs on accumulators directly via the
    // exported snapshot builder.
    const snaps = buildWorkbuddySessionSnapshots([
      { sessionId: "ses-1", userMessages: 0, assistantMessages: MAX_RECORD_MESSAGES + 1,
        totalMessages: MAX_RECORD_MESSAGES + 1, minMs: 0, maxMs: 1000, cwd: null, lastModel: null },
    ]);
    expect(snaps).toEqual([]);
  });

  it("keeps a session whose message counts sit exactly at MAX_RECORD_MESSAGES", () => {
    const snaps = buildWorkbuddySessionSnapshots([
      { sessionId: "ses-1", userMessages: MAX_RECORD_MESSAGES, assistantMessages: 0,
        totalMessages: MAX_RECORD_MESSAGES, minMs: 0, maxMs: 1000, cwd: null, lastModel: null },
    ]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.totalMessages).toBe(MAX_RECORD_MESSAGES);
  });
});

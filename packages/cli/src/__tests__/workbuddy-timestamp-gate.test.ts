import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectWorkbuddySessions } from "../parsers/workbuddy-session.ts";
import { parseWorkbuddyFile } from "../parsers/workbuddy.ts";

function usageRow(ts: unknown, messageId: string): string {
  return JSON.stringify({
    type: "message", timestamp: ts,
    providerData: { model: "m", messageId,
      rawUsage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100,
        completion_tokens: 20, completion_thinking_tokens: 5, total_tokens: 120 } },
  }) + "\n";
}

const TS = 1757491200000; // 2025-09-10T08:00:00.000Z

describe("workbuddy timestamp server-window gate", () => {
  // Both parsers format timestamps back out through toISOString, whose output
  // the server's ingest regex (`^\d{4}-…`) rejects unless the year is 4-digit.
  // The token parser's gate is covered in workbuddy-length-caps.test.ts; these
  // pin the two gaps that gate left open.

  it("session parser: an extended-year ISO string yields no snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-gate-"));
    const file = join(dir, "s.jsonl");
    // Date.parse accepts extended years; toISOString would render
    // "+275760-…" with a 6-digit year and 400 the whole batch.
    writeFileSync(file, JSON.stringify({
      sessionId: "ses-1", type: "message", role: "assistant",
      timestamp: "+275760-09-13T00:00:00Z", message: { model: "m" },
    }) + "\n");
    const snaps = await collectWorkbuddySessions(file);
    rmSync(dir, { recursive: true, force: true });
    expect(snaps).toEqual([]);
  });

  it("session parser: normal epoch timestamps still produce bounds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-gate-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, JSON.stringify({
      sessionId: "ses-1", type: "message", role: "assistant",
      timestamp: TS, message: { model: "m" },
    }) + "\n");
    const snaps = await collectWorkbuddySessions(file);
    rmSync(dir, { recursive: true, force: true });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.startedAt).toBe("2025-09-10T08:00:00.000Z");
  });

  it("token parser: a row dropped by the ISO gate does not occupy its messageId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-gate-"));
    const file = join(dir, "s.jsonl");
    // An out-of-window timestamp row carrying id M1, then the same request
    // rewritten with a corrected timestamp: the corrected row must survive.
    writeFileSync(file, usageRow(5e15, "M1") + usageRow(TS, "M1"));
    const r = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]!.timestamp).toBe("2025-09-10T08:00:00.000Z");
    expect(r.emittedMessageIds).toEqual(["M1"]);
  });
});

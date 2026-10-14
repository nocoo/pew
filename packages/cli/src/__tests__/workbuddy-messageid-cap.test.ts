import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorkbuddyFile } from "../parsers/workbuddy.ts";

// messageId persists into the cursor's dedup ring (SEEN_ID_CAP entries per
// file). A corrupted or hostile file carrying 100KB ids would grow the ring —
// and every later sync's cursor read/write — to hundreds of megabytes (the
// ring holds 2000 entries, ten times Claude's 200). An absurd id is not a
// dedup key we can keep: gate it like any other over-long string field. The
// row is dropped before it claims the id slot, so a later rewrite carrying a
// sane id for the same request still counts.

function usageRow(id: string): string {
  return JSON.stringify({
    type: "message", timestamp: 1757491200000,
    providerData: { model: "m", messageId: id,
      rawUsage: { prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10,
        completion_tokens: 0, total_tokens: 10 } },
  }) + "\n";
}

describe("workbuddy parser gates oversized messageIds", () => {
  it("drops a row whose messageId exceeds MAX_STRING_LENGTH and keeps later sane rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-idcap-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [
      usageRow("x".repeat(1025)),
      usageRow("real-id"),
      "",
    ].join("\n"));
    const r = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.emittedMessageIds).toEqual(["real-id"]);
    expect(r.deltas).toHaveLength(1);
  });

  it("keeps a messageId sitting exactly at MAX_STRING_LENGTH", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-idcap-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [
      usageRow("x".repeat(1024)),
      "",
    ].join("\n"));
    const r = await parseWorkbuddyFile({ filePath: file, startOffset: 0 });
    rmSync(dir, { recursive: true, force: true });
    expect(r.emittedMessageIds).toHaveLength(1);
  });
});

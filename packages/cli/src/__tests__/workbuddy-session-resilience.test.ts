import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectWorkbuddySessions } from "../parsers/workbuddy-session";

describe("WorkBuddy session parser resilience", () => {
  it("skips primitive JSONL rows (null, array, bare string) instead of crashing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-session-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [
      "null",
      JSON.stringify({ sessionId: "s1", type: "message", message: { id: "m1", role: "user" }, timestamp: "2026-03-01T10:00:00Z" }),
      "[1,2]",
      '"just-a-string"',
      JSON.stringify({ sessionId: "s1", type: "message", message: { id: "m2", role: "assistant" }, timestamp: "2026-03-01T10:01:00Z" }),
    ].join("\n") + "\n");

    const sessions = await collectWorkbuddySessions(file);

    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.totalMessages).toBe(2);
  });
});

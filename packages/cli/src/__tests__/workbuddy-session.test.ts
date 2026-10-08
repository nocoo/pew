import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectWorkbuddySessions } from "../parsers/workbuddy-session.js";
import { hashProjectRef } from "../utils/hash-project-ref.js";

const T0 = 1757491200000; // 2025-09-10T08:00:00.000Z
const CWD = "/Users/someone/WorkBuddy/2026-09-10-14-51-14";

function record(over: Record<string, unknown>): string {
  return JSON.stringify({
    sessionId: "session-1",
    cwd: CWD,
    timestamp: T0,
    ...over,
  });
}

describe("collectWorkbuddySessions", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pew-workbuddy-session-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("builds one snapshot per file with counts, bounds and hashed project ref", async () => {
    const file = join(dir, "session-1.jsonl");
    await writeFile(
      file,
      `${[
        record({ type: "message", role: "user", timestamp: T0 }),
        record({ type: "reasoning", timestamp: T0 + 5_000 }),
        record({
          type: "function_call",
          timestamp: T0 + 10_000,
          providerData: { agent: "cli", model: "hy4-preview" },
        }),
        record({ type: "function_call_result", timestamp: T0 + 12_000 }),
        record({ type: "message", role: "assistant", timestamp: T0 + 20_000 }),
        // No sessionId — auxiliary rows must not inflate the counts.
        JSON.stringify({ type: "file-history-snapshot", timestamp: T0 + 21_000 }),
      ].join("\n")}\n`,
    );

    const snapshots = await collectWorkbuddySessions(file);
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.sessionKey).toBe("workbuddy:session-1");
    expect(snap.source).toBe("workbuddy");
    expect(snap.kind).toBe("human");
    expect(snap.startedAt).toBe("2025-09-10T08:00:00.000Z");
    expect(snap.lastMessageAt).toBe("2025-09-10T08:00:20.000Z");
    expect(snap.durationSeconds).toBe(20);
    expect(snap.userMessages).toBe(1);
    expect(snap.assistantMessages).toBe(1);
    expect(snap.totalMessages).toBe(5);
    expect(snap.projectRef).toBe(hashProjectRef(CWD));
    expect(snap.model).toBe("hy4-preview");
  });

  it("groups records by sessionId when a file carries more than one", async () => {
    const file = join(dir, "mixed.jsonl");
    await writeFile(
      file,
      `${[
        record({ type: "message", role: "user", sessionId: "a" }),
        record({ type: "message", role: "assistant", sessionId: "b", timestamp: T0 + 1_000 }),
      ].join("\n")}\n`,
    );

    const snapshots = await collectWorkbuddySessions(file);
    expect(snapshots.map((s) => s.sessionKey).sort()).toEqual([
      "workbuddy:a",
      "workbuddy:b",
    ]);
  });

  it("returns nothing for an empty or unreadable file", async () => {
    const empty = join(dir, "empty.jsonl");
    await writeFile(empty, "");
    expect(await collectWorkbuddySessions(empty)).toEqual([]);
    expect(await collectWorkbuddySessions(join(dir, "missing.jsonl"))).toEqual([]);
  });
});

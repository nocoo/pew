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

  it("excludes ai-title rows even though they carry a sessionId", async () => {
    const file = join(dir, "session-1.jsonl");
    await writeFile(
      file,
      `${[
        // Live installs write the title row WITH the session id, so counting
        // every session-id-bearing row would inflate totalMessages by one.
        record({ type: "ai-title", aiTitle: "t", timestamp: T0 }),
        record({ type: "message", role: "user", timestamp: T0 + 1_000 }),
        record({ type: "message", role: "assistant", timestamp: T0 + 2_000 }),
      ].join("\n")}\n`,
    );

    const snapshots = await collectWorkbuddySessions(file);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.totalMessages).toBe(2);
    expect(snapshots[0]!.userMessages).toBe(1);
    expect(snapshots[0]!.assistantMessages).toBe(1);
    expect(snapshots[0]!.startedAt).toBe("2025-09-10T08:00:01.000Z");
  });

  it("excludes the session-meta row: no message count, no timestamp claim", async () => {
    const file = join(dir, "session-1.jsonl");
    await writeFile(
      file,
      `${[
        // WorkBuddy 5.7.6 writes a session-meta row carrying both a sessionId
        // and its own epoch-ms stamp. Excluding it by type keeps totalMessages
        // message-only and keeps startedAt/lastMessageAt derived from real
        // messages alone.
        JSON.stringify({
          type: "session-meta",
          id: "meta-1",
          sessionId: "session-1",
          timestamp: T0 + 3_000,
          meta: { "codebuddy.ai/hostKind": "unopted" },
        }),
        record({ type: "message", role: "user", timestamp: T0 + 4_500 }),
        record({ type: "message", role: "assistant", timestamp: T0 + 6_000 }),
      ].join("\n")}\n`,
    );

    const snapshots = await collectWorkbuddySessions(file);
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.totalMessages).toBe(2);
    expect(snap.userMessages).toBe(1);
    expect(snap.assistantMessages).toBe(1);
    // startedAt must come from the first message, not the session-meta stamp.
    expect(snap.startedAt).toBe("2025-09-10T08:00:04.500Z");
    expect(snap.lastMessageAt).toBe("2025-09-10T08:00:06.000Z");
    expect(snap.durationSeconds).toBe(1);
  });

  it("ignores an out-of-range timestamp instead of throwing", async () => {
    const file = join(dir, "session-1.jsonl");
    await writeFile(
      file,
      `${[
        record({ type: "message", role: "user", timestamp: 1e20 }),
        record({ type: "message", role: "assistant", timestamp: T0 + 2_000 }),
      ].join("\n")}\n`,
    );

    const snapshots = await collectWorkbuddySessions(file);
    expect(snapshots).toHaveLength(1);
    // The unusable stamp neither throws nor becomes a bound.
    expect(snapshots[0]!.startedAt).toBe("2025-09-10T08:00:02.000Z");
    expect(snapshots[0]!.totalMessages).toBe(2);
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

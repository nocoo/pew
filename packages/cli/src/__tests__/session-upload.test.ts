import { describe, it, expect } from "vitest";
import { deduplicateSessionRecords } from "../commands/session-upload.js";
import type { SessionQueueRecord } from "@pew/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionRecord(
  overrides: Partial<SessionQueueRecord> = {},
): SessionQueueRecord {
  return {
    session_key: "claude-code|abc123",
    source: "claude-code",
    kind: "human",
    started_at: "2026-03-07T10:00:00.000Z",
    last_message_at: "2026-03-07T10:30:00.000Z",
    duration_seconds: 1800,
    user_messages: 5,
    assistant_messages: 5,
    total_messages: 10,
    project_ref: "proj-hash",
    model: "claude-sonnet-4-20250514",
    snapshot_at: "2026-03-09T12:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deduplicateSessionRecords
// ---------------------------------------------------------------------------

describe("deduplicateSessionRecords", () => {
  it("should return empty array for empty input", () => {
    expect(deduplicateSessionRecords([])).toEqual([]);
  });

  it("should return records unchanged when all session_keys are unique", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({ session_key: "claude-code|aaa" }),
      makeSessionRecord({ session_key: "claude-code|bbb" }),
      makeSessionRecord({ session_key: "gemini-cli|ccc" }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(3);
  });

  it("should keep only the latest snapshot_at for duplicate session_keys", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T10:00:00.000Z",
        user_messages: 3,
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
        user_messages: 7,
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].user_messages).toBe(7);
    expect(result[0].snapshot_at).toBe("2026-03-09T12:00:00.000Z");
  });

  it("should keep earlier record if it has a later snapshot_at", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T14:00:00.000Z",
        total_messages: 20,
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
        total_messages: 10,
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].total_messages).toBe(20);
    expect(result[0].snapshot_at).toBe("2026-03-09T14:00:00.000Z");
  });

  it("should handle three snapshots of the same session", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "opencode|xyz",
        snapshot_at: "2026-03-09T08:00:00.000Z",
        duration_seconds: 600,
      }),
      makeSessionRecord({
        session_key: "opencode|xyz",
        snapshot_at: "2026-03-09T12:00:00.000Z",
        duration_seconds: 3600,
      }),
      makeSessionRecord({
        session_key: "opencode|xyz",
        snapshot_at: "2026-03-09T10:00:00.000Z",
        duration_seconds: 1800,
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].duration_seconds).toBe(3600);
    expect(result[0].snapshot_at).toBe("2026-03-09T12:00:00.000Z");
  });

  it("should deduplicate across different sources independently", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T10:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "gemini-cli|bbb",
        snapshot_at: "2026-03-09T09:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "gemini-cli|bbb",
        snapshot_at: "2026-03-09T11:00:00.000Z",
      }),
    ];

    const result = deduplicateSessionRecords(records);
    expect(result).toHaveLength(2);
    const keys = result.map((r) => r.session_key).sort();
    expect(keys).toEqual(["claude-code|aaa", "gemini-cli|bbb"]);

    const claude = result.find((r) => r.session_key === "claude-code|aaa")!;
    expect(claude.snapshot_at).toBe("2026-03-09T12:00:00.000Z");

    const gemini = result.find((r) => r.session_key === "gemini-cli|bbb")!;
    expect(gemini.snapshot_at).toBe("2026-03-09T11:00:00.000Z");
  });

  it("should not mutate the input array", () => {
    const records: SessionQueueRecord[] = [
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T10:00:00.000Z",
      }),
      makeSessionRecord({
        session_key: "claude-code|aaa",
        snapshot_at: "2026-03-09T12:00:00.000Z",
      }),
    ];

    const original = [...records];
    deduplicateSessionRecords(records);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(original[0]);
    expect(records[1]).toEqual(original[1]);
  });

  it("should preserve all fields from the winning record", () => {
    const winner = makeSessionRecord({
      session_key: "openclaw|hash123",
      source: "openclaw",
      kind: "automated",
      started_at: "2026-03-09T08:00:00.000Z",
      last_message_at: "2026-03-09T09:30:00.000Z",
      duration_seconds: 5400,
      user_messages: 0,
      assistant_messages: 15,
      total_messages: 30,
      project_ref: "agent-abc",
      model: null,
      snapshot_at: "2026-03-09T14:00:00.000Z",
    });

    const loser = makeSessionRecord({
      session_key: "openclaw|hash123",
      snapshot_at: "2026-03-09T10:00:00.000Z",
      total_messages: 5,
    });

    const result = deduplicateSessionRecords([loser, winner]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(winner);
  });
});

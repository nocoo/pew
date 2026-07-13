import { describe, it, expect } from "vitest";
import { parseZcodeSessions } from "../parsers/zcode-session.js";
import type {
  ZcodeSessionDb,
  ZcodeSessionRow,
  ZcodeMessageCounts,
} from "../parsers/zcode-types.js";

const BASE_TIME = 1783646250829;

const LOCAL_SESSION: ZcodeSessionRow = {
  id: "sess_1d50eb1b",
  directory: "/Users/nocoo/workspace/personal/zhe",
  title: "了解当前项目结构",
  timeCreated: BASE_TIME,
  timeUpdated: BASE_TIME + 36051,
  taskType: "interactive",
};

function mockDb(
  sessions: ZcodeSessionRow[],
  counts: Record<string, ZcodeMessageCounts> = {},
  primaryModels: Record<string, string | null> = {},
): ZcodeSessionDb {
  return {
    querySessions(lastTimeUpdated, skipIds) {
      const watermark = lastTimeUpdated ?? 0;
      const skip = new Set(skipIds);
      return sessions
        .filter((s) => s.timeUpdated >= watermark && !skip.has(s.id))
        .sort(
          (a, b) =>
            a.timeUpdated - b.timeUpdated || a.id.localeCompare(b.id),
        );
    },
    queryMessages(sessionId) {
      return counts[sessionId] ?? { user: 0, assistant: 0, total: 0 };
    },
    queryPrimaryModel(sessionId) {
      return primaryModels[sessionId] ?? null;
    },
    close() {
      // no-op
    },
  };
}

const FIXED_NOW = new Date("2026-07-12T00:00:00.000Z");
const now = () => FIXED_NOW;

describe("parseZcodeSessions", () => {
  it("Case 1 — full session + 5 messages produces a valid snapshot", () => {
    const db = mockDb(
      [LOCAL_SESSION],
      {
        [LOCAL_SESSION.id]: { user: 1, assistant: 4, total: 5 },
      },
      {
        [LOCAL_SESSION.id]: "GLM-5.2",
      },
    );
    const result = parseZcodeSessions({
      db,
      lastTimeUpdated: null,
      now,
    });
    expect(result.snapshots).toHaveLength(1);
    const s = result.snapshots[0];
    expect(s).toMatchObject({
      sessionKey: "zcode:sess_1d50eb1b",
      source: "zcode",
      kind: "human",
      startedAt: new Date(LOCAL_SESSION.timeCreated).toISOString(),
      lastMessageAt: new Date(LOCAL_SESSION.timeUpdated).toISOString(),
      userMessages: 1,
      assistantMessages: 4,
      totalMessages: 5,
      projectRef: "/Users/nocoo/workspace/personal/zhe",
      model: "GLM-5.2",
    });
    // 36051 ms → 36 seconds (floor)
    expect(s.durationSeconds).toBe(36);
    expect(s.snapshotAt).toBe(FIXED_NOW.toISOString());
  });

  it("Case 2 — no message rows: counts default to 0", () => {
    const db = mockDb([LOCAL_SESSION]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].totalMessages).toBe(0);
    expect(result.snapshots[0].userMessages).toBe(0);
    expect(result.snapshots[0].assistantMessages).toBe(0);
  });

  it("Case 3 — no model_usage rows: model is null", () => {
    const db = mockDb([LOCAL_SESSION]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots[0].model).toBeNull();
  });

  it("Case 4 — empty directory string → projectRef is null", () => {
    const row: ZcodeSessionRow = { ...LOCAL_SESSION, directory: "" };
    const db = mockDb([row]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots[0].projectRef).toBeNull();
  });

  it("Case 4b — whitespace-only directory → projectRef is null", () => {
    const row: ZcodeSessionRow = { ...LOCAL_SESSION, directory: "  \t" };
    const db = mockDb([row]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots[0].projectRef).toBeNull();
  });

  it("Case 4c — leading/trailing whitespace in directory is trimmed off", () => {
    const row: ZcodeSessionRow = {
      ...LOCAL_SESSION,
      directory: "  /Users/x/proj  ",
    };
    const db = mockDb([row]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots[0].projectRef).toBe("/Users/x/proj");
  });

  it("Case 4d — directory is undefined (missing column) → projectRef null (covers ?? '' branch)", () => {
    const row = { ...LOCAL_SESSION, directory: undefined as unknown as string };
    const db = mockDb([row]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots[0].projectRef).toBeNull();
  });

  it("Case 5 — incremental: cursor at last time_updated → new session emitted only", () => {
    const older: ZcodeSessionRow = {
      ...LOCAL_SESSION,
      id: "sess_older",
      timeUpdated: BASE_TIME + 1000,
    };
    const newer: ZcodeSessionRow = {
      ...LOCAL_SESSION,
      id: "sess_newer",
      timeUpdated: BASE_TIME + 5000,
    };
    const db = mockDb([older, newer]);
    const result = parseZcodeSessions({
      db,
      lastTimeUpdated: older.timeUpdated,
      lastProcessedIds: [older.id],
      now,
    });
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].sessionKey).toBe(`zcode:sess_newer`);
  });

  it("Case 6 — same time_updated ms boundary: both emit; boundaryIds contains both", () => {
    const a: ZcodeSessionRow = {
      ...LOCAL_SESSION,
      id: "sess_a",
      timeUpdated: BASE_TIME + 9999,
    };
    const b: ZcodeSessionRow = {
      ...LOCAL_SESSION,
      id: "sess_b",
      timeUpdated: BASE_TIME + 9999,
    };
    const db = mockDb([a, b]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots).toHaveLength(2);
    expect(new Set(result.boundaryIds)).toEqual(
      new Set(["sess_a", "sess_b"]),
    );
    expect(result.maxTimeUpdated).toBe(BASE_TIME + 9999);
  });

  it("Case 6b — out-of-order rows: older row does NOT displace boundaryIds (covers < branch)", () => {
    // mockDb sorts by ascending timeUpdated so we bypass it: hand the parser
    // a raw db that returns rows in a max-then-older order to exercise the
    // "neither > nor ===" fall-through in boundaryIds bookkeeping.
    const rawDb = {
      querySessions() {
        return [
          { ...LOCAL_SESSION, id: "sess_max", timeUpdated: BASE_TIME + 5000 },
          { ...LOCAL_SESSION, id: "sess_older", timeUpdated: BASE_TIME + 1000 },
        ];
      },
      queryMessages: () => ({ user: 0, assistant: 0, total: 0 }),
      queryPrimaryModel: () => null,
      close() {},
    };
    const result = parseZcodeSessions({ db: rawDb, lastTimeUpdated: null, now });
    expect(result.snapshots).toHaveLength(2);
    expect(result.maxTimeUpdated).toBe(BASE_TIME + 5000);
    expect(result.boundaryIds).toEqual(["sess_max"]);
  });

  it("Case 7 — durationSeconds never negative when time_updated < time_created", () => {
    const row: ZcodeSessionRow = {
      ...LOCAL_SESSION,
      timeCreated: BASE_TIME + 5000,
      timeUpdated: BASE_TIME + 1000,
    };
    const db = mockDb([row]);
    const result = parseZcodeSessions({ db, lastTimeUpdated: null, now });
    expect(result.snapshots[0].durationSeconds).toBe(0);
  });
});

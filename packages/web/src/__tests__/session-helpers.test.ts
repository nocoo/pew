import { describe, it, expect } from "vitest";
import {
  toSessionOverview,
  toWorkingHoursGrid,
  toMessageDailyStats,
  computeTokensPerHour,
  toProjectBreakdown,
  type SessionRow,
  type SessionOverview,
} from "@/lib/session-helpers";

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    session_key: "claude-code:test-session",
    source: "claude-code",
    kind: "human",
    started_at: "2026-03-08T10:00:00Z",
    last_message_at: "2026-03-08T10:30:00Z",
    duration_seconds: 1800,
    user_messages: 12,
    assistant_messages: 10,
    total_messages: 25,
    project_ref: null,
    project_name: null,
    model: "claude-sonnet-4-20250514",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toSessionOverview
// ---------------------------------------------------------------------------

describe("toSessionOverview", () => {
  it("should return zeroes for empty input", () => {
    const result = toSessionOverview([]);

    expect(result).toEqual({
      totalSessions: 0,
      totalHours: 0,
      avgDurationMinutes: 0,
      avgMessages: 0,
    });
  });

  it("should compute overview stats from multiple sessions", () => {
    const records = [
      makeSession({ duration_seconds: 3600, total_messages: 20 }),
      makeSession({ duration_seconds: 1800, total_messages: 10 }),
      makeSession({ duration_seconds: 900, total_messages: 30 }),
    ];

    const result = toSessionOverview(records);

    expect(result.totalSessions).toBe(3);
    expect(result.totalHours).toBeCloseTo(1.75, 2); // (3600+1800+900)/3600
    expect(result.avgDurationMinutes).toBeCloseTo(35, 0); // (3600+1800+900)/3/60
    expect(result.avgMessages).toBeCloseTo(20, 0); // (20+10+30)/3
  });

  it("should handle a single session", () => {
    const records = [
      makeSession({ duration_seconds: 7200, total_messages: 50 }),
    ];

    const result = toSessionOverview(records);

    expect(result.totalSessions).toBe(1);
    expect(result.totalHours).toBe(2);
    expect(result.avgDurationMinutes).toBe(120);
    expect(result.avgMessages).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// toWorkingHoursGrid
// ---------------------------------------------------------------------------

describe("toWorkingHoursGrid", () => {
  it("should return 7x24 grid of zeroes for empty input", () => {
    const grid = toWorkingHoursGrid([]);

    expect(grid).toHaveLength(7); // 7 days
    for (const day of grid) {
      expect(day.hours).toHaveLength(24);
      expect(day.hours.every((h) => h === 0)).toBe(true);
    }
  });

  it("should have days in order: Mon, Tue, Wed, Thu, Fri, Sat, Sun", () => {
    const grid = toWorkingHoursGrid([]);

    expect(grid.map((d) => d.day)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });

  it("should count sessions by day-of-week and hour (UTC, tzOffset=0)", () => {
    // 2026-03-08 is a Sunday, 10:00 UTC
    const records = [
      makeSession({ started_at: "2026-03-08T10:00:00Z" }),
      makeSession({ started_at: "2026-03-08T10:30:00Z" }),
      makeSession({ started_at: "2026-03-08T14:00:00Z" }),
    ];

    const grid = toWorkingHoursGrid(records, 0);

    // Sunday is index 6
    const sunday = grid[6]!;
    expect(sunday.day).toBe("Sun");
    expect(sunday.hours[10]).toBe(2); // Two sessions at 10:xx
    expect(sunday.hours[14]).toBe(1); // One session at 14:xx
    expect(sunday.hours[0]).toBe(0); // No sessions at 00:xx
  });

  it("should handle sessions across multiple days (UTC, tzOffset=0)", () => {
    // 2026-03-09 is a Monday, 2026-03-10 is a Tuesday
    const records = [
      makeSession({ started_at: "2026-03-09T09:00:00Z" }),
      makeSession({ started_at: "2026-03-10T15:00:00Z" }),
    ];

    const grid = toWorkingHoursGrid(records, 0);

    // Monday is index 0
    expect(grid[0]!.hours[9]).toBe(1);
    // Tuesday is index 1
    expect(grid[1]!.hours[15]).toBe(1);
  });

  it("should shift hours with positive tzOffset (PST, UTC-8 = 480)", () => {
    // 2026-03-09 Monday 02:00 UTC → Sunday 18:00 PST (shifted back 8h, crosses midnight)
    const records = [
      makeSession({ started_at: "2026-03-09T02:00:00Z" }),
    ];

    const grid = toWorkingHoursGrid(records, 480);

    // UTC Monday 02:00 → PST Sunday 18:00
    const sunday = grid[6]!;
    expect(sunday.day).toBe("Sun");
    expect(sunday.hours[18]).toBe(1);
    // Monday should be empty
    expect(grid[0]!.hours[2]).toBe(0);
  });

  it("should shift hours with negative tzOffset (JST, UTC+9 = -540)", () => {
    // 2026-03-08 Sunday 22:00 UTC → 2026-03-09 Monday 07:00 JST
    const records = [
      makeSession({ started_at: "2026-03-08T22:00:00Z" }),
    ];

    const grid = toWorkingHoursGrid(records, -540);

    // UTC Sunday 22:00 → JST Monday 07:00
    const monday = grid[0]!;
    expect(monday.day).toBe("Mon");
    expect(monday.hours[7]).toBe(1);
    // Sunday should be empty
    expect(grid[6]!.hours[22]).toBe(0);
  });

  it("should default to UTC when tzOffset is omitted", () => {
    // 2026-03-08 is a Sunday, 10:00 UTC
    const records = [
      makeSession({ started_at: "2026-03-08T10:00:00Z" }),
    ];

    const grid = toWorkingHoursGrid(records);

    // Without tzOffset, defaults to 0 (UTC) — Sunday 10:00
    const sunday = grid[6]!;
    expect(sunday.hours[10]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// toMessageDailyStats
// ---------------------------------------------------------------------------

describe("toMessageDailyStats", () => {
  it("should return empty array for empty input", () => {
    expect(toMessageDailyStats([])).toEqual([]);
  });

  it("should group user and assistant messages by day", () => {
    const records = [
      makeSession({
        started_at: "2026-03-08T10:00:00Z",
        user_messages: 10,
        assistant_messages: 8,
      }),
      makeSession({
        started_at: "2026-03-08T14:00:00Z",
        user_messages: 5,
        assistant_messages: 4,
      }),
      makeSession({
        started_at: "2026-03-09T09:00:00Z",
        user_messages: 20,
        assistant_messages: 18,
      }),
    ];

    const daily = toMessageDailyStats(records);

    expect(daily).toHaveLength(2);
    expect(daily[0]).toEqual({
      date: "2026-03-08",
      user: 15,
      assistant: 12,
    });
    expect(daily[1]).toEqual({
      date: "2026-03-09",
      user: 20,
      assistant: 18,
    });
  });

  it("should sort by date ascending", () => {
    const records = [
      makeSession({
        started_at: "2026-03-10T12:00:00Z",
        user_messages: 5,
        assistant_messages: 3,
      }),
      makeSession({
        started_at: "2026-03-08T12:00:00Z",
        user_messages: 10,
        assistant_messages: 8,
      }),
      makeSession({
        started_at: "2026-03-09T12:00:00Z",
        user_messages: 7,
        assistant_messages: 6,
      }),
    ];

    const daily = toMessageDailyStats(records);

    expect(daily.map((d) => d.date)).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
  });
});

// ---------------------------------------------------------------------------
// computeTokensPerHour
// ---------------------------------------------------------------------------

function makeOverview(
  overrides: Partial<SessionOverview> = {},
): SessionOverview {
  return {
    totalSessions: 10,
    totalHours: 5,
    avgDurationMinutes: 30,
    avgMessages: 15,
    ...overrides,
  };
}

describe("computeTokensPerHour", () => {
  it("should compute tokens per hour from total tokens and session overview", () => {
    // 500K tokens over 5 hours = 100K tok/hr
    const result = computeTokensPerHour(500_000, makeOverview({ totalHours: 5 }));

    expect(result.tokensPerHour).toBe(100_000);
    expect(result.totalCodingHours).toBe(5);
    expect(result.totalTokens).toBe(500_000);
  });

  it("should return zero tokens/hour when totalHours is zero", () => {
    const result = computeTokensPerHour(100_000, makeOverview({ totalHours: 0 }));

    expect(result.tokensPerHour).toBe(0);
    expect(result.totalCodingHours).toBe(0);
    expect(result.totalTokens).toBe(100_000);
  });

  it("should handle high throughput values", () => {
    // 10M tokens over 2 hours = 5M tok/hr
    const result = computeTokensPerHour(
      10_000_000,
      makeOverview({ totalHours: 2 }),
    );

    expect(result.tokensPerHour).toBe(5_000_000);
    expect(result.totalCodingHours).toBe(2);
    expect(result.totalTokens).toBe(10_000_000);
  });

  it("should handle zero tokens", () => {
    const result = computeTokensPerHour(0, makeOverview({ totalHours: 3 }));

    expect(result.tokensPerHour).toBe(0);
    expect(result.totalCodingHours).toBe(3);
    expect(result.totalTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toProjectBreakdown
// ---------------------------------------------------------------------------

describe("toProjectBreakdown", () => {
  it("should return empty array for empty input", () => {
    expect(toProjectBreakdown([])).toEqual([]);
  });

  it("should group sessions by project_name", () => {
    const records = [
      makeSession({
        project_name: "pew",
        duration_seconds: 3600,
        user_messages: 10,
        assistant_messages: 8,
        total_messages: 20,
      }),
      makeSession({
        project_name: "pew",
        duration_seconds: 1800,
        user_messages: 5,
        assistant_messages: 4,
        total_messages: 10,
      }),
      makeSession({
        project_name: "studio",
        duration_seconds: 900,
        user_messages: 3,
        assistant_messages: 2,
        total_messages: 6,
      }),
    ];

    const breakdown = toProjectBreakdown(records);

    expect(breakdown).toHaveLength(2);
    // Sorted by session count descending
    expect(breakdown[0]).toEqual({
      projectName: "pew",
      sessions: 2,
      totalHours: 1.5,
      totalMessages: 30,
    });
    expect(breakdown[1]).toEqual({
      projectName: "studio",
      sessions: 1,
      totalHours: 0.25,
      totalMessages: 6,
    });
  });

  it("should label sessions with null project_name as 'Unassigned'", () => {
    const records = [
      makeSession({ project_name: null, duration_seconds: 600, total_messages: 5 }),
      makeSession({ project_name: "my-project", duration_seconds: 1200, total_messages: 10 }),
    ];

    const breakdown = toProjectBreakdown(records);

    expect(breakdown).toHaveLength(2);
    const unassigned = breakdown.find((b) => b.projectName === "Unassigned");
    expect(unassigned).toBeDefined();
    expect(unassigned!.sessions).toBe(1);
  });

  it("should sort by session count descending, then by hours descending", () => {
    const records = [
      makeSession({ project_name: "a", duration_seconds: 100, total_messages: 1 }),
      makeSession({ project_name: "b", duration_seconds: 3600, total_messages: 5 }),
      makeSession({ project_name: "b", duration_seconds: 1800, total_messages: 3 }),
      makeSession({ project_name: "c", duration_seconds: 7200, total_messages: 10 }),
    ];

    const breakdown = toProjectBreakdown(records);

    expect(breakdown.map((b) => b.projectName)).toEqual(["b", "c", "a"]);
  });

  it("should handle all sessions being unassigned", () => {
    const records = [
      makeSession({ project_name: null, total_messages: 5 }),
      makeSession({ project_name: null, total_messages: 3 }),
    ];

    const breakdown = toProjectBreakdown(records);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]!.projectName).toBe("Unassigned");
    expect(breakdown[0]!.sessions).toBe(2);
  });
});

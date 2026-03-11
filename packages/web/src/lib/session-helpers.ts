// ---------------------------------------------------------------------------
// Session data helper types & pure functions
// ---------------------------------------------------------------------------

/** Shape of a row returned by GET /api/sessions */
export type SessionRow = {
  session_key: string;
  source: string;
  kind: string;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  project_ref: string | null;
  project_name: string | null;
  model: string | null;
};

// ---------------------------------------------------------------------------
// toSessionOverview
// ---------------------------------------------------------------------------

export type SessionOverview = {
  totalSessions: number;
  totalHours: number;
  avgDurationMinutes: number;
  avgMessages: number;
};

export function toSessionOverview(records: SessionRow[]): SessionOverview {
  if (records.length === 0) {
    return {
      totalSessions: 0,
      totalHours: 0,
      avgDurationMinutes: 0,
      avgMessages: 0,
    };
  }

  const totalSeconds = records.reduce((s, r) => s + r.duration_seconds, 0);
  const totalMessages = records.reduce((s, r) => s + r.total_messages, 0);

  return {
    totalSessions: records.length,
    totalHours: totalSeconds / 3600,
    avgDurationMinutes: totalSeconds / records.length / 60,
    avgMessages: totalMessages / records.length,
  };
}

// ---------------------------------------------------------------------------
// toWorkingHoursGrid
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type WorkingHoursDay = {
  day: (typeof DAY_NAMES)[number];
  hours: number[];
};

/**
 * Build a 7×24 grid of session counts by day-of-week and hour.
 *
 * @param records  — raw SessionRow[] with ISO 8601 `started_at` timestamps
 * @param tzOffset — minutes offset from UTC (positive = west of UTC, e.g. 480 for PST).
 *                   From `new Date().getTimezoneOffset()`. Defaults to 0 (UTC).
 */
export function toWorkingHoursGrid(
  records: SessionRow[],
  tzOffset: number = 0,
): WorkingHoursDay[] {
  // Initialize 7x24 grid of zeroes
  const grid: WorkingHoursDay[] = DAY_NAMES.map((day) => ({
    day,
    hours: Array.from({ length: 24 }, () => 0),
  }));

  for (const r of records) {
    // Shift UTC time by tzOffset to get local time
    const utcMs = new Date(r.started_at).getTime();
    const localMs = utcMs - tzOffset * 60_000;
    const local = new Date(localMs);

    // Extract day-of-week and hour from the shifted (local) time
    // getUTCDay/getUTCHours on the shifted date gives us local day/hour
    const jsDay = local.getUTCDay();
    // We need Mon=0 ... Sun=6
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
    const hour = local.getUTCHours();
    grid[dayIndex]!.hours[hour]!++;
  }

  return grid;
}

// ---------------------------------------------------------------------------
// toMessageDailyStats
// ---------------------------------------------------------------------------

export type MessageDailyStat = {
  date: string;
  user: number;
  assistant: number;
};

export function toMessageDailyStats(records: SessionRow[]): MessageDailyStat[] {
  if (records.length === 0) return [];

  const byDate = new Map<string, { user: number; assistant: number }>();

  for (const r of records) {
    // Extract YYYY-MM-DD from ISO timestamp
    const date = r.started_at.slice(0, 10);
    const existing = byDate.get(date);
    if (existing) {
      existing.user += r.user_messages;
      existing.assistant += r.assistant_messages;
    } else {
      byDate.set(date, {
        user: r.user_messages,
        assistant: r.assistant_messages,
      });
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({ date, ...stats }));
}

// ---------------------------------------------------------------------------
// computeTokensPerHour
// ---------------------------------------------------------------------------

export type EfficiencyMetrics = {
  tokensPerHour: number;
  totalCodingHours: number;
  totalTokens: number;
};

export function computeTokensPerHour(
  totalTokens: number,
  sessionOverview: SessionOverview,
): EfficiencyMetrics {
  const { totalHours } = sessionOverview;
  return {
    tokensPerHour: totalHours === 0 ? 0 : totalTokens / totalHours,
    totalCodingHours: totalHours,
    totalTokens,
  };
}

// ---------------------------------------------------------------------------
// toProjectBreakdown
// ---------------------------------------------------------------------------

export type ProjectBreakdownItem = {
  projectName: string;
  sessions: number;
  totalHours: number;
  totalMessages: number;
};

/**
 * Aggregate session records by project_name.
 * Sessions with null project_name are grouped as "Unassigned".
 * Sorted by session count descending, then by total hours descending.
 */
export function toProjectBreakdown(
  records: SessionRow[],
): ProjectBreakdownItem[] {
  if (records.length === 0) return [];

  const byProject = new Map<
    string,
    { sessions: number; totalSeconds: number; totalMessages: number }
  >();

  for (const r of records) {
    const name = r.project_name ?? "Unassigned";
    const existing = byProject.get(name);
    if (existing) {
      existing.sessions++;
      existing.totalSeconds += r.duration_seconds;
      existing.totalMessages += r.total_messages;
    } else {
      byProject.set(name, {
        sessions: 1,
        totalSeconds: r.duration_seconds,
        totalMessages: r.total_messages,
      });
    }
  }

  return Array.from(byProject.entries())
    .map(([projectName, stats]) => ({
      projectName,
      sessions: stats.sessions,
      totalHours: stats.totalSeconds / 3600,
      totalMessages: stats.totalMessages,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.totalHours - a.totalHours);
}

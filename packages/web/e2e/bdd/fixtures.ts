import { test as base, expect, type Page } from "@playwright/test";

export const DASHBOARD_USAGE_FIXTURE = {
  records: [
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-01T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 600_000,
    },
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-02T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 600_000,
    },
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-03T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 600_000,
    },
  ],
  summary: {
    total_tokens: 1_800_000,
    input_tokens: 900_000,
    output_tokens: 450_000,
    cached_input_tokens: 300_000,
    reasoning_output_tokens: 150_000,
  },
} as const;

export const DASHBOARD_USAGE_EMPTY_FIXTURE = {
  records: [],
  summary: {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
  },
} as const;

export const DASHBOARD_PRICING_FIXTURE = {
  models: { "claude-sonnet-4-20250514": { input: 3, output: 15, cached: 0.3 } },
  prefixes: [],
  sourceDefaults: {},
  fallback: { input: 0, output: 0 },
} as const;

export type DashboardMockOptions = {
  usage: unknown;
  pricing: unknown;
};

const LEADERBOARD_FIXTURE = {
  period: "week",
  scope: "global",
  entries: [
    {
      rank: 1,
      user: { id: "u1", name: "Alice Test", image: null, slug: "alice" },
      teams: [],
      total_tokens: 2_500_000,
      input_tokens: 1_500_000,
      output_tokens: 800_000,
      cached_input_tokens: 500_000,
      session_count: 42,
      total_duration_seconds: 36_000,
    },
    {
      rank: 2,
      user: { id: "u2", name: "Bob Test", image: null, slug: "bob" },
      teams: [],
      total_tokens: 1_800_000,
      input_tokens: 1_100_000,
      output_tokens: 550_000,
      cached_input_tokens: 350_000,
      session_count: 31,
      total_duration_seconds: 28_000,
    },
    {
      rank: 3,
      user: { id: "u3", name: "Charlie Test", image: null, slug: "charlie" },
      teams: [],
      total_tokens: 1_200_000,
      input_tokens: 700_000,
      output_tokens: 400_000,
      cached_input_tokens: 200_000,
      session_count: 25,
      total_duration_seconds: 20_000,
    },
  ],
  hasMore: false,
} as const;

export async function mockLeaderboardApi(page: Page): Promise<void> {
  await page.route("**/api/leaderboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(LEADERBOARD_FIXTURE),
    }),
  );
}

export async function mockDashboardApis(
  page: Page,
  opts: DashboardMockOptions,
): Promise<void> {
  // Overview tests only consume synthetic data, including ancillary shell APIs.
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = { id: "overview-test", name: "Overview Test", email: "overview@local.invalid", image: null };
    const json = path === "/api/auth/session" ? { user, expires: "2099-01-01T00:00:00Z" }
      : path === "/api/admin/check" ? { isAdmin: false }
        : path === "/api/settings" ? { ...user, slug: "overview-test", is_public: 1 } : {};
    return route.fulfill({ json });
  });
  await page.route("**/api/usage*", (route) => {
    const usage = opts.usage as { records: Array<Record<string, unknown>>; summary: Record<string, number> };
    const params = new URL(route.request().url()).searchParams;
    const from = params.has("from") ? new Date(params.get("from")!).getTime() : -Infinity;
    const to = params.has("to") ? new Date(params.get("to")!).getTime() : Infinity;
    const records = usage.records.filter((row) => {
      const time = new Date(row.hour_start as string).getTime();
      return time >= from && time < to;
    });
    const summary = Object.fromEntries(Object.keys(usage.summary).map((key) => [
      key, records.reduce((total, row) => total + Number(row[key] ?? 0), 0),
    ]));
    return route.fulfill({ json: { records, summary } });
  });
  await page.route("**/api/usage/by-device?*", (route) => {
    const { records } = opts.usage as { records: Array<Record<string, unknown>> };
    const params = new URL(route.request().url()).searchParams;
    const from = new Date(params.get("from")!).getTime();
    const to = new Date(params.get("to")!).getTime();
    const details = records.filter((row) => {
      const time = new Date(row.hour_start as string).getTime();
      return time >= from && time < to;
    }).map((row, i) => ({ ...row, device_id: i < 2 ? "work" : "home" }));
    const tzOffset = Number(params.get("tzOffset") ?? 0);
    const timeline = details.map((row) => ({ ...row,
      date: new Date(new Date(row.hour_start as string).getTime() - tzOffset * 60_000).toISOString().slice(0, 10),
    }));
    return route.fulfill({ json: { deviceDetails: details, timeline,
      devices: ["work", "home"].map((id) => ({
        device_id: id, alias: id === "work" ? "Work Mac" : "Home Mac", sources: [], models: [],
        first_seen: "2026-05-01", last_seen: "2026-05-03", estimated_cost: 0,
        input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0,
      })),
    } });
  });
  await page.route("**/api/pricing", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opts.pricing),
    }),
  );
}

export { base as test, expect };

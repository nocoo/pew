import { test as base, expect, type Page } from "@playwright/test";

export type DataGateResult = { skip: boolean; reason: string };

export function emptyDataGate(count: number, what: string): DataGateResult {
  return count === 0
    ? { skip: true, reason: `Test DB has no ${what}; seed required.` }
    : { skip: false, reason: "" };
}

export async function gotoAdmin(page: Page, path = ""): Promise<void> {
  await page.goto(`/admin${path ? `/${path}` : ""}`);
  await expect(page.locator("main")).toBeVisible();
}

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
      total_tokens: 500_000,
    },
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-02T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 500_000,
    },
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-03T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 500_000,
    },
  ],
  summary: {
    total_tokens: 1_500_000,
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

export const DASHBOARD_ACHIEVEMENTS_FIXTURE = {
  achievements: [],
  summary: {
    totalUnlocked: 0,
    totalAchievements: 0,
    diamondCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    activeDays: 0,
  },
} as const;

export const DASHBOARD_PRICING_FIXTURE = {
  models: {},
  prefixes: [],
  sourceDefaults: {},
  fallback: { input: 0, output: 0 },
} as const;

export type DashboardMockOptions = {
  usage: unknown;
  achievements: unknown;
  pricing: unknown;
};

export async function mockDashboardApis(
  page: Page,
  opts: DashboardMockOptions,
): Promise<void> {
  await page.route("**/api/usage*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opts.usage),
    }),
  );
  await page.route("**/api/achievements*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opts.achievements),
    }),
  );
  await page.route("**/api/pricing", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opts.pricing),
    }),
  );
}

export { base as test, expect };

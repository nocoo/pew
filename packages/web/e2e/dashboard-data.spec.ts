import { test, expect } from "@playwright/test";

const USAGE_FIXTURE = {
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
};

const ACHIEVEMENTS_FIXTURE = {
  achievements: [],
  summary: {
    totalUnlocked: 0,
    totalAchievements: 0,
    diamondCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    activeDays: 0,
  },
};

const PRICING_FIXTURE = {
  models: {},
  prefixes: [],
  sourceDefaults: {},
  fallback: { input: 0, output: 0 },
};

test.describe("dashboard with data", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/usage*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(USAGE_FIXTURE),
      }),
    );
    await page.route("**/api/achievements*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ACHIEVEMENTS_FIXTURE),
      }),
    );
    await page.route("**/api/pricing", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PRICING_FIXTURE),
      }),
    );
  });

  test("shows stat cards when data exists", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Total Tokens")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("1.5M").first()).toBeVisible();
    await expect(page.getByText("Input Tokens")).toBeVisible();
    await expect(page.getByText("900.0K").first()).toBeVisible();
    await expect(page.getByText("Output Tokens")).toBeVisible();
    await expect(page.getByText("450.0K").first()).toBeVisible();
    await expect(page.getByText("Cached Tokens")).toBeVisible();
    await expect(page.getByText("300.0K").first()).toBeVisible();
  });

  test("shows cost section", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Est. Cost")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Cache Savings")).toBeVisible();
  });

  test("shows Overview and Trends segments", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Trends" }),
    ).toBeVisible();
  });

  test("does not show empty state when data exists", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Total Tokens")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Ready to Track Your AI Usage"),
    ).not.toBeVisible();
  });
});

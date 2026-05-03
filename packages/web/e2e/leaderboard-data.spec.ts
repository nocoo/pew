import { test, expect } from "@playwright/test";

const LEADERBOARD_FIXTURE = {
  period: "week",
  scope: "global",
  entries: [
    {
      rank: 1,
      user: { id: "u1", name: "Alice Test", image: null, slug: "alice" },
      teams: [],
      badges: [],
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
      badges: [],
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
      badges: [],
      total_tokens: 1_200_000,
      input_tokens: 700_000,
      output_tokens: 400_000,
      cached_input_tokens: 200_000,
      session_count: 25,
      total_duration_seconds: 20_000,
    },
  ],
  hasMore: false,
};

test.describe("leaderboard with data", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/leaderboard**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LEADERBOARD_FIXTURE),
      }),
    );
  });

  test("displays leaderboard entries", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("Alice Test")).toBeVisible();
    await expect(page.getByText("Bob Test")).toBeVisible();
    await expect(page.getByText("Charlie Test")).toBeVisible();
  });

  test("shows token counts", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("2,500,000")).toBeVisible();
    await expect(page.getByText("1,800,000")).toBeVisible();
    await expect(page.getByText("1,200,000")).toBeVisible();
  });

  test("does not show empty state", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("Alice Test")).toBeVisible();
    await expect(
      page.getByText("No usage data for this period yet."),
    ).not.toBeVisible();
  });

  test("period tabs are functional", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("Alice Test")).toBeVisible();

    await page.getByRole("button", { name: "Last 30 Days" }).click();

    await expect(page.getByText("Alice Test")).toBeVisible();
    await expect(page.getByText("Bob Test")).toBeVisible();
  });
});

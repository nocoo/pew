// Covers old: leaderboard.spec.ts, leaderboard-data.spec.ts
import { test, expect, mockLeaderboardApi } from "./fixtures";

const LEADERBOARD_SUB_PAGES: ReadonlyArray<string> = [
  "achievements",
  "agents",
  "models",
  "showcases",
  "seasons",
];

test.describe("Feature: Leaderboard", () => {
  test("Given auth is bypassed, When I visit /leaderboard, Then the pew heading and Individual/Seasons/Achievements tabs are visible", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit /leaderboard
    await page.goto("/leaderboard");
    // Then: top-level pew heading + three navigation tabs render
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
    await expect(page.getByRole("link", { name: "Individual" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Seasons" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Achievements" })).toBeVisible();
  });

  test("Given auth is bypassed, When I click the Achievements tab from /leaderboard, Then the URL updates to /leaderboard/achievements", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit /leaderboard and click the Achievements tab
    await page.goto("/leaderboard");
    await page.getByRole("link", { name: "Achievements" }).click();
    // Then: URL updates to the achievements sub-page
    await expect(page).toHaveURL(/\/leaderboard\/achievements/);
  });

  for (const subPage of LEADERBOARD_SUB_PAGES) {
    test(`Given auth is bypassed, When I visit /leaderboard/${subPage}, Then the pew heading is visible`, async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: navigate to the leaderboard sub-page
      await page.goto(`/leaderboard/${subPage}`);
      // Then: top-level pew heading renders
      await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
    });
  }

  test("Given auth is bypassed, When I visit /leaderboard/seasons/non-existent-season, Then the URL stays under /leaderboard without crashing", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: navigate to a non-existent season detail page
    await page.goto("/leaderboard/seasons/non-existent-season");
    // Then: URL resolves under /leaderboard (404 or fallback), no crash/redirect away
    expect(page.url()).toContain("/leaderboard");
  });

  test.describe("with mocked leaderboard entries present", () => {
    test.beforeEach(async ({ page }) => {
      // Given: the leaderboard API returns three ranked entries
      await mockLeaderboardApi(page);
    });

    test("Given the leaderboard API returns entries, When I visit /leaderboard, Then the three entry names and token counts are visible and the empty state is hidden", async ({ page }) => {
      // When: visit /leaderboard
      await page.goto("/leaderboard");
      // Then: all three names render (covers old: "displays leaderboard entries")
      await expect(page.getByText("Alice Test")).toBeVisible();
      await expect(page.getByText("Bob Test")).toBeVisible();
      await expect(page.getByText("Charlie Test")).toBeVisible();
      // Then: their formatted token counts render (covers old: "shows token counts")
      await expect(page.getByText("2,500,000")).toBeVisible();
      await expect(page.getByText("1,800,000")).toBeVisible();
      await expect(page.getByText("1,200,000")).toBeVisible();
      // Then: the empty state stays hidden (covers old: "does not show empty state")
      await expect(page.getByText("No usage data for this period yet.")).not.toBeVisible();
    });

    test("Given the leaderboard API returns entries, When I click the Last 30 Days period tab, Then the entries stay visible", async ({ page }) => {
      // When: visit /leaderboard and switch period
      await page.goto("/leaderboard");
      await expect(page.getByText("Alice Test")).toBeVisible();
      await page.getByRole("button", { name: "Last 30 Days" }).click();
      // Then: entries continue to render under the new period (mock returns same data)
      await expect(page.getByText("Alice Test")).toBeVisible();
      await expect(page.getByText("Bob Test")).toBeVisible();
    });
  });
});

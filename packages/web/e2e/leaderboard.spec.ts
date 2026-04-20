import { test, expect } from "@playwright/test";

test.describe("leaderboard main", () => {
  test("page loads with navigation tabs", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
    // Check navigation tabs are present
    await expect(page.getByRole("link", { name: "Individual" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Seasons" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Achievements" })).toBeVisible();
  });

  test("clicking achievements tab navigates correctly", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.getByRole("link", { name: "Achievements" }).click();
    await expect(page).toHaveURL(/\/leaderboard\/achievements/);
  });
});

test.describe("leaderboard sub-pages", () => {
  test("achievements page loads", async ({ page }) => {
    await page.goto("/leaderboard/achievements");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("agents page loads", async ({ page }) => {
    await page.goto("/leaderboard/agents");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("models page loads", async ({ page }) => {
    await page.goto("/leaderboard/models");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("showcases page loads", async ({ page }) => {
    await page.goto("/leaderboard/showcases");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("seasons page loads", async ({ page }) => {
    await page.goto("/leaderboard/seasons");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("season detail page handles non-existent season", async ({ page }) => {
    await page.goto("/leaderboard/seasons/non-existent-season");
    // Should not crash
    const url = page.url();
    expect(url).toContain("/leaderboard");
  });
});

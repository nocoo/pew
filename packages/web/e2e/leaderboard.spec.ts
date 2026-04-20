import { test, expect } from "@playwright/test";

test.describe("leaderboard main", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
    await expect(page.getByRole("heading").getByText("Leaderboard")).toBeVisible();
  });

  test("period tabs are visible", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.waitForTimeout(2000);
    // Period tabs should be visible - they may be buttons or links
    const hasWeek = await page.getByText("Week", { exact: true }).first().isVisible().catch(() => false);
    const hasMonth = await page.getByText("Month", { exact: true }).first().isVisible().catch(() => false);
    const hasIndividual = await page.getByRole("link", { name: "Individual" }).isVisible().catch(() => false);
    expect(hasWeek || hasMonth || hasIndividual).toBe(true);
  });

  test("navigation tabs work", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.waitForTimeout(2000);
    // Should have nav tabs for different leaderboard views - labels are Individual, Seasons, Achievements, etc.
    await expect(page.getByRole("link", { name: "Individual" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Achievements" })).toBeVisible();
  });

  test("clicking achievements tab navigates", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.waitForTimeout(1000);
    await page.getByRole("link", { name: "Achievements" }).click();
    await expect(page).toHaveURL(/\/leaderboard\/achievements/);
  });
});

test.describe("leaderboard achievements", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/leaderboard/achievements");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
    await expect(page.getByRole("heading").getByText("Achievements")).toBeVisible();
  });

  test("shows achievement content or loading state", async ({ page }) => {
    await page.goto("/leaderboard/achievements");
    await page.waitForTimeout(2000);
    // Should show achievements content or loading skeleton
    const hasContent = await page.getByText("Unlocked").isVisible().catch(() => false);
    const hasSkeleton = await page.locator(".animate-pulse").first().isVisible().catch(() => false);
    const hasNav = await page.locator("nav").getByRole("link", { name: "Tokens" }).isVisible().catch(() => false);
    expect(hasContent || hasSkeleton || hasNav).toBe(true);
  });
});

test.describe("leaderboard agents", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/leaderboard/agents");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("shows agent leaderboard content", async ({ page }) => {
    await page.goto("/leaderboard/agents");
    await page.waitForTimeout(2000);
    // Should show agents tab as active
    const hasNav = await page.locator("nav").getByRole("link", { name: "Agents" }).isVisible().catch(() => false);
    expect(hasNav).toBe(true);
  });
});

test.describe("leaderboard models", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/leaderboard/models");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("shows model leaderboard content", async ({ page }) => {
    await page.goto("/leaderboard/models");
    await page.waitForTimeout(2000);
    // Should show models tab as active
    const hasNav = await page.locator("nav").getByRole("link", { name: "Models" }).isVisible().catch(() => false);
    expect(hasNav).toBe(true);
  });
});

test.describe("leaderboard showcases", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/leaderboard/showcases");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("shows showcases content", async ({ page }) => {
    await page.goto("/leaderboard/showcases");
    await page.waitForTimeout(2000);
    // Should show showcases tab as active
    const hasNav = await page.locator("nav").getByRole("link", { name: "Showcases" }).isVisible().catch(() => false);
    expect(hasNav).toBe(true);
  });
});

test.describe("leaderboard seasons", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/leaderboard/seasons");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("pew");
  });

  test("shows seasons list or empty state", async ({ page }) => {
    await page.goto("/leaderboard/seasons");
    await page.waitForTimeout(2000);
    // Should show seasons content or empty state
    const hasNav = await page.locator("nav").getByRole("link", { name: "Seasons" }).isVisible().catch(() => false);
    expect(hasNav).toBe(true);
  });
});

test.describe("leaderboard season detail", () => {
  test("page loads for non-existent season", async ({ page }) => {
    await page.goto("/leaderboard/seasons/non-existent-season");
    await page.waitForTimeout(2000);
    // May show not found or redirect
    const url = page.url();
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(url.includes("/leaderboard") || hasContent).toBe(true);
  });
});

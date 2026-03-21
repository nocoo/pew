import { test, expect } from "@playwright/test";

test.describe("sidebar navigation", () => {
  test("sidebar links are visible", async ({ page }) => {
    await page.goto("/dashboard");
    // Wait for page to load
    await expect(page.locator("h1")).toContainText("Dashboard");

    // Core navigation links in sidebar
    const nav = page.locator("aside nav");
    await expect(nav.getByText("Dashboard", { exact: true })).toBeVisible();
    await expect(nav.getByText("Hourly Usage")).toBeVisible();
    await expect(nav.getByText("Daily Usage")).toBeVisible();
    await expect(nav.getByText("Sessions")).toBeVisible();
  });

  test("clicking sidebar link navigates to correct page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");

    // Navigate to Daily Usage
    await page.locator("aside nav").getByText("Daily Usage").click();
    await expect(page).toHaveURL(/\/daily-usage/);
  });

  test("settings link navigates to settings page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");

    await page.locator("aside nav").getByText("General").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator("h1")).toContainText("General");
  });
});

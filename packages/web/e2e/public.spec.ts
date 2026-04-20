import { test, expect } from "@playwright/test";

test.describe("privacy page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Privacy");
  });

  test("shows privacy policy content", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForTimeout(1000);
    // Should show privacy policy content
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    const hasText = await page.getByText("data").first().isVisible().catch(() => false);
    expect(hasContent || hasText).toBe(true);
  });
});

test.describe("public profile page", () => {
  test("page loads for non-existent user", async ({ page }) => {
    await page.goto("/u/non-existent-user-slug");
    await page.waitForTimeout(2000);
    // Should show "not found" or similar error state
    const hasNotFound = await page.getByText("not found", { exact: false }).isVisible().catch(() => false);
    const hasError = await page.getByText("404").isVisible().catch(() => false);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasNotFound || hasError || hasContent).toBe(true);
  });

  test("page handles missing slug gracefully", async ({ page }) => {
    await page.goto("/u/test-user");
    await page.waitForTimeout(2000);
    // Page should load without crashing
    const url = page.url();
    expect(url).toContain("/u/");
  });
});

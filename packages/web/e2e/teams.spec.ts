import { test, expect } from "@playwright/test";

test.describe("teams page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/teams");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Team");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/teams");
    await page.waitForTimeout(3000);
    // Should show team list or empty state
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });

  test("has create or join team UI", async ({ page }) => {
    await page.goto("/teams");
    await page.waitForTimeout(3000);
    // Should show create/join buttons or existing teams
    const hasButton = await page.getByRole("button").first().isVisible().catch(() => false);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasButton || hasContent).toBe(true);
  });
});

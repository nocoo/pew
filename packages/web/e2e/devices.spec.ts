import { test, expect } from "@playwright/test";

test.describe("device pages", () => {
  test("devices page loads with breakdown", async ({ page }) => {
    await page.goto("/devices");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Device");
    // Should show content or empty state
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });

  test("manage devices page loads", async ({ page }) => {
    await page.goto("/manage-devices");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Device");
  });
});

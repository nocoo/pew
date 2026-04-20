import { test, expect } from "@playwright/test";

test.describe("devices page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/devices");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Device");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/devices");
    await page.waitForTimeout(3000);
    // Should show device list or empty state
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("manage-devices page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/manage-devices");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Device");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/manage-devices");
    await page.waitForTimeout(3000);
    // Should show device management UI or empty state
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

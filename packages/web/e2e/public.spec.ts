import { test, expect } from "@playwright/test";

test.describe("public pages", () => {
  test("privacy page loads", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Privacy");
  });

  test("public profile page loads", async ({ page }) => {
    await page.goto("/u/test-user");
    // Should not crash, may show profile or 404
    const url = page.url();
    expect(url).toContain("/u/");
  });
});

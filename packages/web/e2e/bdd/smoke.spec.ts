// Covers old: smoke.spec.ts
import { test, expect } from "./fixtures";

test.describe("Feature: Smoke", () => {
  test("Given the app is deployed, When I visit the root page, Then the page title matches /pew/i", async ({ page }) => {
    // Given: the app is deployed
    // When: visit the root page
    await page.goto("/");
    // Then: page title matches /pew/i
    await expect(page).toHaveTitle(/pew/i);
  });
});

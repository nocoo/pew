// Covers old: public.spec.ts
import { test, expect } from "./fixtures";

test.describe("Feature: Public pages", () => {
  test("Given the user is unauthenticated, When I visit /privacy, Then the Privacy heading is visible", async ({ page }) => {
    // Given: no authentication needed for public pages
    // When: navigate to /privacy
    await page.goto("/privacy");
    // Then: top-level heading contains "Privacy"
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Privacy");
  });

  test("Given the user is unauthenticated, When I visit /u/test-user, Then the URL stays under /u/ without crashing", async ({ page }) => {
    // Given: no authentication needed for public pages
    // When: navigate to a public profile route
    await page.goto("/u/test-user");
    // Then: page resolves under /u/ (profile or 404, but does not redirect/crash)
    expect(page.url()).toContain("/u/");
  });
});

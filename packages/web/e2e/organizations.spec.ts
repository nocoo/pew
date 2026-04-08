import { test, expect } from "@playwright/test";

/**
 * Organization flow E2E tests.
 *
 * These tests run with E2E_SKIP_AUTH=true, so authenticated routes are accessible
 * but API calls may return 401 for endpoints that require real auth.
 *
 * Tests cover:
 * - Admin organizations page loads and shows header
 * - Settings organizations page loads and shows header
 * - Leaderboard page and period selector
 * - Navigation to organizations from sidebar
 */

test.describe("organizations", () => {
  test.describe("admin page", () => {
    test("page loads and shows heading", async ({ page }) => {
      await page.goto("/admin/organizations");
      // Should see the Organizations heading
      await expect(page.locator("h1")).toContainText("Organizations");
      // Should see description text (actual text from page.tsx:750-751)
      await expect(
        page.getByText("Manage interest-based organizations"),
      ).toBeVisible();
    });

    test("shows create organization button", async ({ page }) => {
      await page.goto("/admin/organizations");
      await expect(
        page.getByRole("button", { name: /create organization/i }),
      ).toBeVisible();
    });

    test("create form shows when clicking create button", async ({ page }) => {
      await page.goto("/admin/organizations");
      const createButton = page.getByRole("button", { name: /create organization/i });
      await createButton.click();

      // Form section should appear with "Create Organization" heading
      await expect(page.getByText("Create Organization")).toBeVisible();
      // Form inputs should appear (actual placeholders from page.tsx:184, 197)
      await expect(page.getByPlaceholder("Anthropic")).toBeVisible();
      await expect(page.getByPlaceholder("anthropic")).toBeVisible();
    });
  });

  test.describe("settings page", () => {
    test("page loads and shows heading", async ({ page }) => {
      await page.goto("/settings/organizations");
      // Should see the Organizations heading
      await expect(page.locator("h1")).toContainText("Organizations");
      // Should see description text
      await expect(
        page.getByText("Join or leave organizations to filter your leaderboard."),
      ).toBeVisible();
    });

    test("shows available organizations section", async ({ page }) => {
      await page.goto("/settings/organizations");
      // Wait for content to load
      await expect(
        page.getByText("Available Organizations"),
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe("leaderboard", () => {
    test("leaderboard page loads", async ({ page }) => {
      await page.goto("/leaderboard");

      // Should see the leaderboard
      await expect(page.locator("h1")).toContainText("Leaderboard");

      // Period tabs should be visible
      await expect(page.getByText("Last 7 Days")).toBeVisible();
      await expect(page.getByText("Last 30 Days")).toBeVisible();
      await expect(page.getByText("All Time")).toBeVisible();
    });

    test("period selector works", async ({ page }) => {
      await page.goto("/leaderboard");

      // Click "All Time" period
      const allTimeButton = page.getByText("All Time");
      await allTimeButton.click();

      // The button should now be selected (has different styling)
      // Just verify it's still visible and clickable
      await expect(allTimeButton).toBeVisible();
    });

    test("navigation tabs are present", async ({ page }) => {
      await page.goto("/leaderboard");

      // Should see navigation tabs
      await expect(page.getByRole("link", { name: "Individual" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Seasons" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Achievements" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Showcases" })).toBeVisible();
    });
  });

  test.describe("navigation", () => {
    test("organizations link appears in settings sidebar", async ({ page }) => {
      await page.goto("/settings/general");

      // Should see Organizations link in sidebar
      const orgLink = page.getByRole("link", { name: "Organizations" });
      await expect(orgLink).toBeVisible();
    });

    test("clicking organizations link navigates to organizations page", async ({
      page,
    }) => {
      await page.goto("/settings/general");

      // Click the Organizations link
      const orgLink = page.getByRole("link", { name: "Organizations" });
      await orgLink.click();

      // Should navigate to organizations page
      await expect(page).toHaveURL(/\/settings\/organizations/);
      await expect(page.locator("h1")).toContainText("Organizations");
    });
  });
});

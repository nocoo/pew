import { test, expect } from "@playwright/test";

test.describe("auth bypass (E2E_SKIP_AUTH=true)", () => {
  test("visiting /dashboard does NOT redirect to /login", async ({ page }) => {
    await page.goto("/dashboard");
    // With skip-auth, proxy passes all requests through — no redirect
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator("h1")).toContainText("Dashboard");
  });

  test("visiting /settings does NOT redirect to /login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator("h1")).toContainText("General");
  });

  test("login page is still accessible", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Sign in to view your dashboard")).toBeVisible();
  });
});

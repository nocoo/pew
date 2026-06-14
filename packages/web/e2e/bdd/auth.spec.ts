// Covers old: auth.spec.ts
import { test, expect } from "./fixtures";

test.describe("Feature: Auth bypass (E2E_SKIP_AUTH=true)", () => {
  test("Given auth is bypassed, When I visit /dashboard, Then I land on /dashboard with the Dashboard heading", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: navigate to /dashboard
    await page.goto("/dashboard");
    // Then: no redirect to /login; dashboard heading renders
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("Given auth is bypassed, When I visit /settings, Then I land on /settings with the General heading", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: navigate to /settings
    await page.goto("/settings");
    // Then: no redirect to /login; General heading renders
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  });

  test("Given auth is bypassed, When I visit /login, Then the login page is still accessible", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: navigate to /login
    await page.goto("/login");
    // Then: login page renders normally
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Sign in to view your dashboard")).toBeVisible();
  });
});

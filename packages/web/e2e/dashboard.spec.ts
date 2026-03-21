import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");
    await expect(
      page.getByText("Token usage overview for your AI coding tools."),
    ).toBeVisible();
  });

  test("stat cards are rendered", async ({ page }) => {
    await page.goto("/dashboard");
    // Wait for stat cards to appear (they load async)
    await expect(page.getByText("Total Tokens")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Input Tokens")).toBeVisible();
    await expect(page.getByText("Output Tokens")).toBeVisible();
    await expect(page.getByText("Est. Cost")).toBeVisible();
  });

  test("period selector is present", async ({ page }) => {
    await page.goto("/dashboard");
    // PeriodSelector renders period buttons
    await expect(page.getByText("Total Tokens")).toBeVisible({
      timeout: 15_000,
    });
    // At least one period option should be visible
    const periodButtons = page.locator("button").filter({ hasText: /day|week|month|all/i });
    await expect(periodButtons.first()).toBeVisible();
  });
});

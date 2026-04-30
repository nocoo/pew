import { test, expect } from "@playwright/test";

test.describe("admin pages", () => {
  test("badges page loads", async ({ page }) => {
    await page.goto("/admin/badges");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Badge");
  });

  test("compare page loads", async ({ page }) => {
    await page.goto("/admin/compare");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Compare");
  });

  test("compare result page loads", async ({ page }) => {
    await page.goto("/admin/compare/result");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Compare");
  });

  test("invites page loads", async ({ page }) => {
    await page.goto("/admin/invites");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Invite");
  });

  test("model-prices page loads", async ({ page }) => {
    await page.goto("/admin/model-prices");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Model Prices");
  });

  test("seasons page loads", async ({ page }) => {
    await page.goto("/admin/seasons");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Season");
  });

  test("showcases page loads", async ({ page }) => {
    await page.goto("/admin/showcases");
    await expect(page.locator("main")).toBeVisible();
  });

  test("storage page loads", async ({ page }) => {
    await page.goto("/admin/storage");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Storage");
  });
});

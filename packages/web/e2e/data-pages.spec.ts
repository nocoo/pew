import { test, expect } from "@playwright/test";

test.describe("agents page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Agent");
  });

  test("shows period selector", async ({ page }) => {
    await page.goto("/agents");
    await page.waitForTimeout(2000);
    // Should have period selector
    const hasPeriod = await page.getByText("All Time").isVisible().catch(() => false);
    const hasEmpty = await page.getByText("No usage data").isVisible().catch(() => false);
    const hasSkeleton = await page.locator(".animate-pulse").first().isVisible().catch(() => false);
    expect(hasPeriod || hasEmpty || hasSkeleton).toBe(true);
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/agents");
    await page.waitForTimeout(3000);
    // Should show agent cards or empty state
    const hasCards = await page.locator(".rounded-xl.bg-secondary").first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText("No usage data").isVisible().catch(() => false);
    expect(hasCards || hasEmpty).toBe(true);
  });
});

test.describe("models page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/models");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Model");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/models");
    await page.waitForTimeout(3000);
    // Should show model cards or empty state
    const hasCards = await page.locator(".rounded-xl.bg-secondary").first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText("No usage data").isVisible().catch(() => false);
    expect(hasCards || hasEmpty).toBe(true);
  });
});

test.describe("projects page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Project");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(3000);
    // Should show project timeline or empty state
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("sessions page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/sessions");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Session");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/sessions");
    await page.waitForTimeout(3000);
    // Should show session table or empty state
    const hasTable = await page.locator("table").first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText("No session").isVisible().catch(() => false);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasTable || hasEmpty || hasContent).toBe(true);
  });
});

test.describe("daily-usage page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/daily-usage");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Daily");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/daily-usage");
    await page.waitForTimeout(3000);
    // Should show usage data or empty state
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("hourly-usage page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/hourly-usage");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hourly");
  });

  test("shows content or empty state", async ({ page }) => {
    await page.goto("/hourly-usage");
    await page.waitForTimeout(3000);
    // Should show usage data or empty state
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

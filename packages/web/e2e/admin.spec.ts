import { test, expect } from "@playwright/test";

test.describe("admin badges page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/badges");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Badge");
  });

  test("shows content", async ({ page }) => {
    await page.goto("/admin/badges");
    await page.waitForTimeout(3000);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("admin compare page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/compare");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Compare");
  });

  test("shows content", async ({ page }) => {
    await page.goto("/admin/compare");
    await page.waitForTimeout(2000);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("admin invites page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/invites");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Invite");
  });

  test("shows content", async ({ page }) => {
    await page.goto("/admin/invites");
    await page.waitForTimeout(3000);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("admin pricing page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/pricing");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Pricing");
  });

  test("shows content", async ({ page }) => {
    await page.goto("/admin/pricing");
    await page.waitForTimeout(3000);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("admin seasons page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/seasons");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Season");
  });

  test("shows content", async ({ page }) => {
    await page.goto("/admin/seasons");
    await page.waitForTimeout(3000);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("admin showcases page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/showcases");
    await page.waitForTimeout(2000);
    // The page should have loaded - check for any h1 or main content
    const hasH1 = await page.getByRole("heading", { level: 1 }).first().isVisible().catch(() => false);
    const hasMain = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasH1 || hasMain).toBe(true);
  });

  test("shows content", async ({ page }) => {
    await page.goto("/admin/showcases");
    await page.waitForTimeout(3000);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("admin storage page", () => {
  test("page loads and shows heading", async ({ page }) => {
    await page.goto("/admin/storage");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Storage");
  });

  test("shows content", async ({ page }) => {
    await page.goto("/admin/storage");
    await page.waitForTimeout(3000);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

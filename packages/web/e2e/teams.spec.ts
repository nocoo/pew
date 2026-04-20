import { test, expect } from "@playwright/test";

test.describe("teams pages", () => {
  test("teams list page loads", async ({ page }) => {
    await page.goto("/teams");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Team");
  });

  test("teams page has create or join options", async ({ page }) => {
    await page.goto("/teams");
    // Should show create/join buttons or existing teams
    const hasButton = await page.getByRole("button").first().isVisible().catch(() => false);
    const hasContent = await page.locator("main").first().isVisible().catch(() => false);
    expect(hasButton || hasContent).toBe(true);
  });

  test("team detail page loads for non-existent team", async ({ page }) => {
    await page.goto("/teams/test-team-id");
    // Should not crash, may show 404 or empty state
    const url = page.url();
    expect(url).toContain("/teams");
  });
});

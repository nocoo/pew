// Covers old: data-pages.spec.ts, devices.spec.ts, settings-projects.spec.ts
import { test, expect } from "./fixtures";

const SUMMARY_PAGES: ReadonlyArray<{ path: string; keyword: string }> = [
  { path: "/agents", keyword: "Agent" },
  { path: "/models", keyword: "Model" },
  { path: "/projects", keyword: "Project" },
  { path: "/sessions", keyword: "Session" },
  { path: "/daily-usage", keyword: "Daily" },
  { path: "/hourly-usage", keyword: "Hourly" },
];

test.describe("Feature: Data summary pages", () => {
  for (const { path, keyword } of SUMMARY_PAGES) {
    test(`Given auth is bypassed, When I visit ${path}, Then the heading contains "${keyword}"`, async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: navigate to the summary page
      await page.goto(path);
      // Then: top-level heading contains the expected keyword
      await expect(page.getByRole("heading", { level: 1 })).toContainText(keyword);
    });
  }

  test("Given auth is bypassed, When I visit /devices and /manage-devices, Then both render the Device heading and /devices shows main content", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit the devices analytics page
    await page.goto("/devices");
    // Then: Device heading is visible and main content renders (covers old: "devices page loads with breakdown")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Device");
    await expect(page.locator("main").first()).toBeVisible();
    // When: visit the device management page
    await page.goto("/manage-devices");
    // Then: Device heading is visible (covers old: "manage devices page loads")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Device");
  });

  test("Given auth is bypassed, When I visit /settings/showcases and /manage-projects, Then settings resolves under /settings or /login and projects shows the Project heading", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit settings showcases
    await page.goto("/settings/showcases");
    // Then: URL stays under /settings or redirects to /login (covers old: "settings showcases page loads")
    const settingsUrl = page.url();
    expect(settingsUrl.includes("/settings") || settingsUrl.includes("/login")).toBe(true);
    // When: visit manage projects
    await page.goto("/manage-projects");
    // Then: Project heading is visible (covers old: "manage projects page loads")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Project");
  });
});

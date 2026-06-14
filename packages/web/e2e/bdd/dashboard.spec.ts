// Covers old: dashboard.spec.ts, dashboard-data.spec.ts, navigation.spec.ts
import {
  test,
  expect,
  DASHBOARD_USAGE_FIXTURE,
  DASHBOARD_USAGE_EMPTY_FIXTURE,
  DASHBOARD_ACHIEVEMENTS_FIXTURE,
  DASHBOARD_PRICING_FIXTURE,
  mockDashboardApis,
} from "./fixtures";

test.describe("Feature: Dashboard", () => {
  test("Given auth is bypassed, When I visit /dashboard, Then the Dashboard heading and tagline are visible", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit /dashboard
    await page.goto("/dashboard");
    // Then: Dashboard heading is visible and tagline renders
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(
      page.getByText("Token usage overview for your AI coding tools."),
    ).toBeVisible();
  });

  test.describe("with mocked usage data present", () => {
    test.beforeEach(async ({ page }) => {
      // Given: usage / achievements / pricing APIs return non-empty data
      await mockDashboardApis(page, {
        usage: DASHBOARD_USAGE_FIXTURE,
        achievements: DASHBOARD_ACHIEVEMENTS_FIXTURE,
        pricing: DASHBOARD_PRICING_FIXTURE,
      });
    });

    test("Given the usage API returns data, When I visit /dashboard, Then the four token stat cards are visible", async ({ page }) => {
      // When: visit /dashboard
      await page.goto("/dashboard");
      // Then: all four token stat cards show their labels and aggregated values
      await expect(page.getByText("Total Tokens")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("1.5M").first()).toBeVisible();
      await expect(page.getByText("Input Tokens")).toBeVisible();
      await expect(page.getByText("900.0K").first()).toBeVisible();
      await expect(page.getByText("Output Tokens")).toBeVisible();
      await expect(page.getByText("450.0K").first()).toBeVisible();
      await expect(page.getByText("Cached Tokens")).toBeVisible();
      await expect(page.getByText("300.0K").first()).toBeVisible();
    });

    test("Given the usage API returns data, When I visit /dashboard, Then the cost section is visible", async ({ page }) => {
      // When: visit /dashboard
      await page.goto("/dashboard");
      // Then: Est. Cost + Cache Savings labels render
      await expect(page.getByText("Est. Cost")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Cache Savings")).toBeVisible();
    });

    test("Given the usage API returns data, When I visit /dashboard, Then the Overview and Trends segments are visible", async ({ page }) => {
      // When: visit /dashboard
      await page.goto("/dashboard");
      // Then: both segment headings render
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Trends" })).toBeVisible();
    });

    test("Given the usage API returns data, When I visit /dashboard, Then the empty state is not visible", async ({ page }) => {
      // When: visit /dashboard
      await page.goto("/dashboard");
      // Then: empty state stays hidden once data has loaded
      await expect(page.getByText("Total Tokens")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Ready to Track Your AI Usage")).not.toBeVisible();
    });
  });

  test.describe("with mocked empty usage data", () => {
    test.beforeEach(async ({ page }) => {
      // Given: usage API returns summary.total_tokens === 0 -> empty state branch
      await mockDashboardApis(page, {
        usage: DASHBOARD_USAGE_EMPTY_FIXTURE,
        achievements: DASHBOARD_ACHIEVEMENTS_FIXTURE,
        pricing: DASHBOARD_PRICING_FIXTURE,
      });
    });

    test("Given the usage API returns no data, When I visit /dashboard, Then the empty state title is visible", async ({ page }) => {
      // When: visit /dashboard
      await page.goto("/dashboard");
      // Then: empty-state title renders
      await expect(page.getByText("Ready to Track Your AI Usage")).toBeVisible({
        timeout: 10_000,
      });
    });

    test("Given the usage API returns no data, When I visit /dashboard, Then the empty state shows the Install pew CLI step and Get Started CTA", async ({ page }) => {
      // When: visit /dashboard
      await page.goto("/dashboard");
      // Then: getting-started CTA + CLI install step both render
      await expect(page.getByText("Install the pew CLI")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("link", { name: "Get Started" })).toBeVisible();
    });
  });

  test("Given auth is bypassed, When I visit /dashboard, Then the sidebar shows Dashboard/Hourly Usage/Daily Usage/Sessions links", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit /dashboard
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    // Then: aside nav contains the four core navigation labels
    const nav = page.locator("aside nav");
    await expect(nav.getByText("Dashboard", { exact: true })).toBeVisible();
    await expect(nav.getByText("Hourly Usage")).toBeVisible();
    await expect(nav.getByText("Daily Usage")).toBeVisible();
    await expect(nav.getByText("Sessions")).toBeVisible();
  });

  test("Given auth is bypassed, When I click Daily Usage in the sidebar, Then I land on /daily-usage", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit /dashboard and click the sidebar Daily Usage link
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.locator("aside nav").getByText("Daily Usage").click();
    // Then: URL updates to /daily-usage
    await expect(page).toHaveURL(/\/daily-usage/);
  });

  test("Given auth is bypassed, When I click General in the sidebar, Then I land on /settings with the General heading", async ({ page }) => {
    // Given: E2E_SKIP_AUTH=true is set by the runner
    // When: visit /dashboard and click the sidebar General link
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.locator("aside nav").getByText("General").click();
    // Then: URL updates to /settings and General heading renders
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  });
});

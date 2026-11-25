import type { Page } from "@playwright/test";
import {
  test,
  expect,
  DASHBOARD_USAGE_FIXTURE,
  DASHBOARD_USAGE_EMPTY_FIXTURE,
  DASHBOARD_PRICING_FIXTURE,
  mockDashboardApis,
} from "./fixtures";

const stat = (page: Page, title: string) => page.getByText(title, { exact: true }).locator("..");

test.describe("Feature: Overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await mockDashboardApis(page, {
      usage: DASHBOARD_USAGE_FIXTURE,
      pricing: DASHBOARD_PRICING_FIXTURE,
    });
  });

  test("overview displays summary metrics and switches breakdown dimensions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
    await expect(stat(page, "Est. Cost").getByText("$11.79", { exact: true })).toBeVisible();

    const breakdown = page.getByRole("region", { name: "Usage breakdown", exact: true });
    const bar = breakdown.getByRole("figure", { name: "Daily token breakdown", exact: true });
    const share = breakdown.getByRole("figure", { name: "Token share", exact: true });
    await expect(bar.getByText("Daily Tokens by Model", { exact: true })).toBeVisible();
    await expect(share.getByText("1.8M tokens", { exact: true })).toBeVisible();

    await breakdown.getByRole("button", { name: "Harness", exact: true }).click();
    await expect(bar.getByText("Daily Tokens by Harness", { exact: true })).toBeVisible();
    await expect(share.getByText("Claude Code", { exact: true })).toBeVisible();

    await breakdown.getByRole("button", { name: "Device", exact: true }).click();
    await expect(bar.getByText("Daily Tokens by Device", { exact: true })).toBeVisible();
    await expect(share.getByText("Work Mac", { exact: true })).toBeVisible();
    await expect(share.getByText("Home Mac", { exact: true })).toBeVisible();
  });

  test("the period selector bounds daily, hourly and device queries and keeps annual goals", async ({
    page,
  }) => {
    const requests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/usage" || url.pathname === "/api/usage/by-device")
        requests.push(url);
    });
    await page.goto("/dashboard");
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    const breakdown = page.getByRole("region", { name: "Usage breakdown", exact: true });
    await breakdown.getByRole("button", { name: "Device", exact: true }).click();
    await expect(breakdown.getByText("1.8M tokens", { exact: true })).toBeVisible();
    for (const [label, startMonth, hasUsage] of [
      ["Last 6 Months", 2, true],
      ["Last 3 Months", 5, false],
      ["Last 1 Month", 7, false],
    ] as const) {
      requests.length = 0;
      await page.getByRole("button", { name: label, exact: true }).click();
      if (hasUsage)
        await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
      else await expect(page.getByText("No usage in this period.", { exact: true })).toBeVisible();
      const from = await page.evaluate(
        (month) => new Date(2026, month, 15).toISOString(),
        startMonth,
      );
      await expect
        .poll(() => requests.filter((url) => url.searchParams.get("from") === from).length)
        .toBeGreaterThanOrEqual(3);
      await expect(
        page
          .getByRole("region", { name: "Activity", exact: true })
          .getByText("1.8M", { exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("button", { name: "All Time", exact: true }).click();
    await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
  });

  test("usage request failures offer retry without presenting a zero hit rate", async ({
    page,
  }) => {
    await page.route("**/api/usage?*", (route) =>
      route.fulfill({ status: 500, json: { error: "Usage unavailable" } }),
    );
    await page.goto("/dashboard");
    await expect(page.getByText(/Failed to load usage data/)).toBeVisible();
    await expect(page.getByText("Cache Hit Rate", { exact: true })).toHaveCount(0);
    await mockDashboardApis(page, {
      usage: DASHBOARD_USAGE_FIXTURE,
      pricing: DASHBOARD_PRICING_FIXTURE,
    });
    await page.getByRole("button", { name: "Retry usage", exact: true }).click();
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
  });

  test("accounts without usage retain the getting started state", async ({ page }) => {
    await mockDashboardApis(page, {
      usage: DASHBOARD_USAGE_EMPTY_FIXTURE,
      pricing: DASHBOARD_PRICING_FIXTURE,
    });
    await page.goto("/dashboard");
    await expect(page.getByText("Ready to Track Your AI Usage")).toBeVisible();
    await expect(page.getByRole("link", { name: "Get Started" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Salary calculator", exact: true })).toHaveCount(
      0,
    );
  });
});

import { test, expect, DASHBOARD_USAGE_FIXTURE, DASHBOARD_PRICING_FIXTURE, mockDashboardApis } from "./fixtures";

test.describe("Feature: Expanded model history", () => {
  for (const count of [101]) {
    test(`retains ${count} historical models up to the hundred-series cap`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
      await page.emulateMedia({ reducedMotion: "reduce" });
      const records = Array.from({ length: count }, (_, i) => ({ ...DASHBOARD_USAGE_FIXTURE.records[0],
        model: `original/model-${String(i).padStart(3, "0")}`,
        hour_start: i < 30 ? "2026-09-15T00:00:00.000Z" : "2026-01-04T00:00:00.000Z",
      }));
      await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
      await page.goto("/dashboard");
      const chart = page.getByRole("figure", { name: "Daily token breakdown", exact: true });
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator(".recharts-bar")).toHaveCount(Math.min(count, 101));
      const more = chart.getByRole("button", { name: `Show all ${Math.min(count, 101)} series`, exact: true });
      await expect(more).toBeVisible();
      await more.click();
      const legend = page.getByRole("dialog", { name: "All chart series", exact: true });
      await expect(legend.locator("li")).toHaveCount(Math.min(count, 101));
      await expect(legend).toContainText("original/model-082");
      await expect(legend.getByText("Other models", { exact: true })).toHaveCount(count > 100 ? 1 : 0);
      await page.keyboard.press("Escape");
      const oldBar = chart.locator(".recharts-bar").nth(40).locator(".recharts-rectangle").first();
      await expect(oldBar).toBeAttached();
      const box = await oldBar.boundingBox();
      expect(box?.height).toBeGreaterThan(0);
    });
  }

  for (const width of [1440]) {
    test(`bounds daily tooltip details without changing chart data at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
      await page.emulateMedia({ reducedMotion: "reduce" });
      const records = Array.from({ length: 23 }, (_, i) => ({ ...DASHBOARD_USAGE_FIXTURE.records[0],
        model: i === 22 ? "inactive-on-selected-day" : `original/model-${String(i).padStart(3, "0")}`,
        hour_start: i === 22 ? "2026-09-15T00:00:00.000Z" : "2026-09-14T00:00:00.000Z",
      }));
      await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
      await page.goto("/dashboard");
      const chart = page.getByRole("figure", { name: "Daily token breakdown", exact: true });
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator(".recharts-bar")).toHaveCount(23);
      const bar = chart.locator(".recharts-bar").filter({ has: page.locator("path[name='original/model-000']") }).locator("path").first();
      await bar.hover();
      const tooltip = chart.locator(".recharts-tooltip-wrapper");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText("2 more series");
      await expect(tooltip).toContainText("13.2M");
      await expect(tooltip).not.toContainText("inactive-on-selected-day");
      await expect(tooltip.locator("[title^='original/model-']")).toHaveCount(20);
      const box = (await tooltip.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeLessThanOrEqual(850);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(chart.locator(".recharts-bar")).toHaveCount(23);
    });
  }
});

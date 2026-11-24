import { type Locator, type Page } from "@playwright/test";
import { test, expect, mockDashboardApis, DASHBOARD_PRICING_FIXTURE, watchPageReadiness } from "./fixtures";

test.use({ timezoneId: "UTC", reducedMotion: "reduce" });

function card(page: Page, name: string): Locator {
  return page.locator("p").filter({ hasText: new RegExp(`^${name}$`) })
    .locator("xpath=ancestor::*[(self::div or self::figure) and .//*[local-name()='svg' and contains(@class,'recharts-surface')]][1]");
}

async function stacked(first: Locator, second: Locator) {
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(Math.abs(a.x - b.x)).toBeLessThan(2);
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);
}

for (const width of [1440]) {
  test(`trend panels stack and agent visualizations load real data at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const [route, first, second] of [["/models", "Tool Usage Trend", "Model Evolution"],
      ["/devices", "Agent Trend", "Model Mix"], ["/agents", "Tool Usage Trend", "By Agent"]] as const) {
      const readiness = watchPageReadiness(page);
      await page.goto(route);
      const top = card(page, first);
      const bottom = card(page, second);
      await expect(top.locator(".recharts-line-curve").first()).toBeAttached();
      await expect(bottom.locator(".recharts-area-area, .recharts-pie-sector").first()).toBeAttached();
      await stacked(top, bottom);
      await top.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-trend.png`) });
      await bottom.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-share.png`) });
      if (route === "/agents") {
        const group = page.getByRole("heading", { name: "Claude Code", exact: true });
        expect((await group.boundingBox())!.y).toBeGreaterThan((await bottom.boundingBox())!.y);
      }
      await readiness.ready(["/api/usage", "/api/pricing"]);
      readiness.dispose();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    }
  });
}

test("model evolution keeps one hundred models while point details and legends stay bounded", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
  const sources = ["claude-code", "codex", "gemini-cli", "grok", "hermes", "openclaw", "pi"];
  const models = ["Other", "raven-jp1/gpt-6-astra", "gpt-5.6", "models/a[b]", ...Array.from({ length: 98 }, (_, i) => `model-${i}`)];
  const records = ["2026-10-01", "2026-10-02"].flatMap((date) => models.map((model, i) => ({ source: sources[i % sources.length], model,
    hour_start: date, input_tokens: 102 - i, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 102 - i })));
  await mockDashboardApis(page, { usage: { records, summary: { total_tokens: 10506 } }, pricing: DASHBOARD_PRICING_FIXTURE });
  await page.goto("/models");
  const trend = card(page, "Tool Usage Trend");
  await expect(trend.locator(".recharts-line-curve")).toHaveCount(7);
  await trend.getByRole("button", { name: "Show all 7 series" }).click();
  await page.getByRole("dialog", { name: "All chart series" }).getByRole("button", { name: "Pi", exact: true }).click();
  await expect(trend.locator(".recharts-line-curve")).toHaveCount(1);
  await page.getByRole("dialog", { name: "All chart series" }).getByRole("button", { name: "Pi", exact: true }).click();
  await expect(trend.locator(".recharts-line-curve")).toHaveCount(7);
  await page.keyboard.press("Escape");
  const evolution = card(page, "Model Evolution");
  await expect(evolution.locator(".recharts-area")).toHaveCount(101);
  await evolution.getByRole("button", { name: "Show all 101 series" }).click();
  const legend = page.getByRole("dialog", { name: "All chart series" });
  await expect(legend.getByRole("listitem")).toHaveCount(101);
  await expect(legend.getByText("Other", { exact: true })).toBeAttached();
  await expect(legend.getByText("Other models", { exact: true })).toBeAttached();
  await page.keyboard.press("Escape");
  await evolution.scrollIntoViewIfNeeded();
  const plot = (await evolution.locator(".recharts-surface").boundingBox())!;
  await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
  const tooltip = evolution.locator(".recharts-tooltip-wrapper");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("81 more series");
  await expect(tooltip).toContainText("100.0%");
  await expect(tooltip.locator('[title="raven-jp1/gpt-6-astra"]')).toBeVisible();
});

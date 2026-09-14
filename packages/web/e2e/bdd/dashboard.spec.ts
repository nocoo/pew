import type { Page } from "@playwright/test";
import {
  test, expect, DASHBOARD_USAGE_FIXTURE, DASHBOARD_USAGE_EMPTY_FIXTURE,
  DASHBOARD_PRICING_FIXTURE, mockDashboardApis,
} from "./fixtures";
import { buildPricingMap } from "../../src/lib/pricing";

const stat = (page: Page, title: string) => page.getByText(title, { exact: true }).locator("..");

function annotatedRecord() {
  const row = DASHBOARD_USAGE_FIXTURE.records[0];
  const basis = { input_tokens: row.input_tokens, cached_input_tokens: row.cached_input_tokens,
    output_tokens: row.output_tokens, reasoning_output_tokens: row.reasoning_output_tokens, total_tokens: row.total_tokens };
  return { ...row, accounting: [{ status: "matched", basis, groups: [{
    basis, counts: { input_total_tokens: 400_000, output_total_tokens: 200_000,
      cache_read_input_tokens: 100_000, cache_write_input_tokens: 50_000,
      cache_write_5m_input_tokens: 50_000, cache_write_1h_input_tokens: 0, reasoning_output_tokens: 50_000 },
    model: row.model, provider: "anthropic", route: "direct", service_tier: "default",
    origin: "claude:usage", quality: "reported", context_tokens_min: 400_000, context_tokens_max: 400_000,
    request_count: 1, diagnostics: [], reported_costs: [],
  }] }] };
}

test.describe("Feature: Overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await mockDashboardApis(page, { usage: DASHBOARD_USAGE_FIXTURE, pricing: DASHBOARD_PRICING_FIXTURE });
  });

  test("the original overview highlights cache hit rate and removes the replacement view", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText(/100% read coverage/)).toBeVisible();
    await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Read Tokens").getByText("300.0K", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Write Tokens").getByText("—", { exact: true })).toBeVisible();
    await expect(stat(page, "Est. Cost").getByText("$11.79", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Legacy area", exact: true })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Overview metrics" })).toHaveCount(0);
    await expect(page.locator("#overview-charts")).toHaveCount(0);
    for (const name of ["Activity", "Goal Tracker"]) {
      await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
    }
    for (const name of ["Usage summary", "Trends", "Insights"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    for (const name of ["Daily Cache Hit Rate", "By Agent", "Input / Output", "Weekday vs Weekend", "Hourly Usage"]) {
      await expect(page.locator("#main-content").getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("the period selector bounds both daily and hourly queries and keeps annual goals", async ({ page }) => {
    const requests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/usage") requests.push(url);
    });
    await page.goto("/dashboard");
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    requests.length = 0;
    await page.getByRole("button", { name: "This Month", exact: true }).click();
    await expect(page.getByText("No usage in this period.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "All Time", exact: true })).toBeVisible();
    await expect(page.getByText("Ready to Track Your AI Usage")).not.toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText("—", { exact: true })).toBeVisible();
    const from = await page.evaluate(() => new Date(2026, 8, 1).toISOString());
    const day = requests.find((url) => url.searchParams.get("granularity") === "day" && url.searchParams.get("from") === from);
    const hourly = requests.find((url) => url.searchParams.get("granularity") === "half-hour" && url.searchParams.get("from") === from);
    expect(day).toBeDefined();
    expect(hourly).toBeDefined();
    expect(day?.searchParams.get("to")).toBe(hourly?.searchParams.get("to"));
    await expect(page.getByRole("region", { name: "Activity", exact: true }).getByText("1.8M", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "All Time", exact: true }).click();
    await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
  });

  for (const width of [1440, 390]) {
    test(`cache hit rate leads the summary and original controls work at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/dashboard");
      await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
      const total = (await stat(page, "Total Tokens").boundingBox())!;
      const hit = (await stat(page, "Cache Hit Rate").boundingBox())!;
      const input = (await stat(page, "Input Tokens").boundingBox())!;
      if (width >= 1024) {
        expect(Math.abs(hit.y - total.y)).toBeLessThan(2);
        expect(hit.x).toBeGreaterThan(total.x);
        expect(hit.x).toBeLessThan(input.x);
      } else {
        expect(hit.y).toBeGreaterThan(total.y);
        expect(hit.y).toBeLessThan(input.y);
      }
      await page.getByRole("button", { name: "Cost", exact: true }).click();
      await expect(page.getByText("Daily Cost", { exact: true })).toBeVisible();
      await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
      const settings = page.getByRole("button", { name: "Goal settings", exact: true });
      await settings.click();
      const dialog = page.getByRole("dialog", { name: "Goal Thresholds", exact: true });
      await dialog.getByLabel("Lower threshold (M tokens/day)").fill("10");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(settings).toBeFocused();
      await settings.click();
      await expect(dialog.getByLabel("Lower threshold (M tokens/day)")).toHaveValue("10");
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    });

    test(`salary calculator retains the selected calendar period at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/dashboard");
      const trigger = page.getByRole("button", { name: "Salary calculator", exact: true });
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Salary calculator", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/138 calendar days/)).toBeVisible();
      await expect(dialog.getByText("Huang Ratio", { exact: true })).toBeVisible();
      const slider = dialog.getByRole("slider").first();
      const before = await slider.getAttribute("aria-valuenow");
      await slider.focus();
      await page.keyboard.press("ArrowRight");
      await expect(slider).not.toHaveAttribute("aria-valuenow", before!);
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width - 16);
      if (width >= 1024) expect(box.width).toBeGreaterThan(1000);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    });
  }

  test("uncollected cache counts never become a zero-percent hit rate", async ({ page }) => {
    const records = DASHBOARD_USAGE_FIXTURE.records.map((row) => ({
      ...row, source: "hermes", cached_input_tokens: 0, input_tokens: 400_000,
    }));
    await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.goto("/dashboard");
    for (const title of ["Cache Hit Rate", "Cache Read Tokens", "Cache Write Tokens", "Net Cache Savings"]) {
      await expect(stat(page, title).getByText("—", { exact: true })).toBeVisible();
    }
    await expect(stat(page, "Cache Hit Rate").getByText("Read counts unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg —", { exact: true })).toBeVisible();
  });

  test("mixed clients use a weighted hit rate over covered input and disclose partial reads and writes", async ({ page }) => {
    const records = [annotatedRecord(),
      { ...DASHBOARD_USAGE_FIXTURE.records[1], input_tokens: 400_000, cached_input_tokens: 400_000, total_tokens: 1_000_000 },
      { ...DASHBOARD_USAGE_FIXTURE.records[2], source: "hermes", input_tokens: 800_000, cached_input_tokens: 0, total_tokens: 1_000_000 },
    ];
    await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.goto("/dashboard");
    await expect(stat(page, "Cache Hit Rate").getByText("41.7%", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText(/60% read coverage.*partial/i)).toBeVisible();
    await expect(stat(page, "Cache Read Tokens").getByText("500.0K", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Read Tokens").getByText(/60%.*partial/i)).toBeVisible();
    await expect(stat(page, "Cache Write Tokens").getByText("50.0K", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Write Tokens").getByText(/20%.*partial/i)).toBeVisible();
    await expect(stat(page, "Total Tokens").getByText("2.6M", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg 41.7%", { exact: true })).toBeVisible();
  });

  test("complete cache writes, a measured zero hit rate and negative net savings remain visible", async ({ page }) => {
    const record = annotatedRecord();
    const pricing = buildPricingMap({ dynamic: [{ model: `anthropic/${record.model}`, provider: "Anthropic", displayName: record.model,
      inputPerMillion: 3, outputPerMillion: 15, cachedPerMillion: 0.3, cacheWritePerMillion: 3.75,
      origin: "models.dev", route: "direct", contextWindow: 1_000_000, updatedAt: "2026-09-01T00:00:00Z" }] });
    await mockDashboardApis(page, { usage: { records: [record], summary: DASHBOARD_USAGE_FIXTURE.summary }, pricing });
    await page.goto("/dashboard");
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Read Tokens").getByText("100.0K", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Write Tokens").getByText("50.0K", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Write Tokens").getByText("100% input covered", { exact: true })).toBeVisible();
    await expect(stat(page, "Net Cache Savings").getByText("$0.23", { exact: true })).toBeVisible();
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText("Net cache savings: $0.23", { exact: false })).toBeVisible();

    const counts = record.accounting[0]!.groups[0]!.counts;
    counts.cache_read_input_tokens = 0;
    counts.cache_write_input_tokens = 400_000;
    counts.cache_write_5m_input_tokens = 400_000;
    await mockDashboardApis(page, { usage: { records: [record], summary: DASHBOARD_USAGE_FIXTURE.summary }, pricing });
    await page.reload();
    await expect(stat(page, "Cache Hit Rate").getByText("0.0%", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText(/100% read coverage/)).toBeVisible();
    await expect(stat(page, "Net Cache Savings").getByText("-$0.30", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg 0.0%", { exact: true })).toBeVisible();
  });

  test("usage request failures offer retry without presenting a zero hit rate", async ({ page }) => {
    await page.route("**/api/usage?*", (route) => route.fulfill({ status: 500, json: { error: "Usage unavailable" } }));
    await page.goto("/dashboard");
    await expect(page.getByText(/Failed to load usage data/)).toBeVisible();
    await expect(page.getByText("Cache Hit Rate", { exact: true })).toHaveCount(0);
    await mockDashboardApis(page, { usage: DASHBOARD_USAGE_FIXTURE, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.getByRole("button", { name: "Retry usage", exact: true }).click();
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
  });

  test("accounts without usage retain the getting started state", async ({ page }) => {
    await mockDashboardApis(page, { usage: DASHBOARD_USAGE_EMPTY_FIXTURE, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.goto("/dashboard");
    await expect(page.getByText("Ready to Track Your AI Usage")).toBeVisible();
    await expect(page.getByRole("link", { name: "Get Started" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Salary calculator", exact: true })).toBeDisabled();
  });

  test("the Overview navigation still links to daily usage and settings", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.locator("aside nav");
    await expect(nav.getByText("Overview", { exact: true })).toBeVisible();
    await nav.getByRole("button", { name: "Daily Usage" }).click();
    await expect(page).toHaveURL(/\/daily-usage/);
    await nav.getByRole("button", { name: "General" }).click();
    await expect(page).toHaveURL(/\/settings/);
  });
});

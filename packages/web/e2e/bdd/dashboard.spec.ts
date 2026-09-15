import type { Page } from "@playwright/test";
import {
  test, expect, DASHBOARD_USAGE_FIXTURE, DASHBOARD_USAGE_EMPTY_FIXTURE,
  DASHBOARD_PRICING_FIXTURE, mockDashboardApis,
} from "./fixtures";
import { buildPricingMap } from "../../src/lib/pricing";

const stat = (page: Page, title: string) => page.getByText(title, { exact: true }).locator("..");
const statCard = (page: Page, title: string) => page.getByText(title, { exact: true }).locator("xpath=ancestor::div[@data-basalt-surface][1]");

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

  test("usage summary groups supporting metrics into three aligned cards and retains its visual accents", async ({ page }) => {
    const records = DASHBOARD_USAGE_FIXTURE.records.map((row) => ({ ...row, hour_start: row.hour_start.replace("2026-05", "2026-09") }));
    await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.goto("/dashboard");
    await expect(stat(page, "Monthly Forecast")).toBeVisible();
    for (const [title, children] of [
      ["Total Tokens", ["Input Tokens", "Output Tokens"]],
      ["Cache Hit Rate", ["Cache Read", "Cache Write"]],
      ["Est. Cost", ["Monthly Forecast", "Daily Average"]],
    ] as const) {
      const card = statCard(page, title);
      for (const child of children) await expect(card.getByText(child, { exact: true })).toBeVisible();
      await expect(card.locator("svg").first()).toBeVisible();
      await expect(card.locator("[aria-hidden='true']").first()).toBeVisible();
    }
    const boxes = await Promise.all(["Total Tokens", "Cache Hit Rate", "Est. Cost"].map((title) => statCard(page, title).boundingBox()));
    expect(Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y))).toBeLessThan(2);
    expect(Math.max(...boxes.map((box) => box!.height)) - Math.min(...boxes.map((box) => box!.height))).toBeLessThan(2);
    const summary = page.getByRole("heading", { name: "Usage summary", exact: true }).locator("xpath=ancestor::section[1]");
    await expect(summary.locator(".border-dashed")).toBeVisible();
    await summary.getByRole("button", { name: "More information", exact: true }).focus();
    await expect(page.getByRole("tooltip")).toContainText("TD compares the same elapsed days");
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText(/Cache reads:.*300.0K/)).toBeVisible();
    await expect(page.getByText(/Cache writes:.*unavailable/)).toBeVisible();
  });

  test("full week and month comparisons return without expanding the summary into extra rows", async ({ page }) => {
    const records = Array.from({ length: 46 }, (_, day) => ({ ...DASHBOARD_USAGE_FIXTURE.records[0],
      hour_start: new Date(Date.UTC(2026, 7, day + 1)).toISOString(),
    }));
    await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.goto("/dashboard");
    for (const title of ["Total Tokens", "Est. Cost"]) {
      const card = statCard(page, title);
      for (const label of ["vs week TD", "vs month TD", "vs last week", "vs last month"]) {
        await expect(card.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(card.getByText("vs last week", { exact: true }).locator("..").getByText("-57%", { exact: true })).toBeVisible();
      await expect(card.getByText("vs last month", { exact: true }).locator("..").getByText("-52%", { exact: true })).toBeVisible();
      expect((await card.boundingBox())!.height).toBeLessThan(360);
    }
    await expect(statCard(page, "Est. Cost").getByText("vs last month", { exact: true }).locator("..").getByText("-52%", { exact: true })).toHaveClass(/text-success/);
  });

  for (const width of [1440, 1920, 2560, 768, 390]) {
    test(`activity and goals retain one annual strip of circular days beside salary at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/dashboard");
      const regions = ["Activity", "Goal Tracker", "Salary calculator"].map((name) => page.getByRole("region", { name, exact: true }));
      for (const region of regions) await expect(region).toBeVisible();
      const boxes = await Promise.all(regions.map((region) => region.boundingBox()));
      if (width >= 1280) {
        expect(Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y))).toBeLessThan(2);
        expect(Math.max(...boxes.map((box) => box!.height)) - Math.min(...boxes.map((box) => box!.height))).toBeLessThan(2);
        expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x);
        expect(boxes[0]!.height).toBeLessThan(300);
      } else {
        expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
        expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y);
      }
      for (const region of regions.slice(0, 2)) {
        const box = (await region.boundingBox())!;
        const dates = region.getByRole("img", { name: /^2026-/ });
        await expect(dates).toHaveCount(365);
        const geometry = await dates.evaluateAll((cells) => cells.map((cell) => {
          const rect = cell.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            radius: Number.parseFloat(getComputedStyle(cell).borderTopLeftRadius) };
        }));
        expect(new Set(geometry.map((cell) => cell.y)).size).toBe(7);
        expect(geometry.at(-1)!.x).toBeGreaterThan(geometry[0]!.x);
        for (const cell of geometry) {
          expect(cell.width).toBe(cell.height);
          expect(cell.width).toBeGreaterThanOrEqual(10);
          expect(cell.radius).toBeGreaterThanOrEqual(cell.width / 2);
        }
        for (const date of ["2026-01-01", "2026-06-30", "2026-07-01", "2026-09-15", "2026-12-31"]) {
          const cell = region.getByRole("img", { name: new RegExp(`^${date}:`) });
          await cell.scrollIntoViewIfNeeded();
          const position = (await cell.boundingBox())!;
          expect(position.x).toBeGreaterThanOrEqual(box.x);
          expect(position.x + position.width).toBeLessThanOrEqual(box.x + box.width);
        }
      }
      await expect(regions[2]!.getByRole("button", { name: "Salary settings", exact: true })).toBeEnabled();
      await expect(page.getByRole("slider")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    });
  }

  test("annual calendars retain leap day and tooltips after scrolling across the year", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.clock.setFixedTime(new Date("2028-02-29T12:00:00Z"));
    await page.goto("/dashboard");
    for (const name of ["Activity", "Goal Tracker"]) {
      const region = page.getByRole("region", { name, exact: true });
      await expect(region.getByRole("img", { name: /^2028-/ })).toHaveCount(366);
      for (const date of ["2028-02-29", "2028-06-30", "2028-07-01", "2028-12-31"]) {
        await region.getByRole("img", { name: `${date}: Tokens 0`, exact: true }).hover();
        const tooltip = region.getByRole("tooltip");
        await expect(tooltip).toContainText(date);
        expect((await tooltip.getByText(date, { exact: true }).boundingBox())!.height).toBeLessThanOrEqual(20);
        const box = (await tooltip.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
      }
    }
  });

  for (const width of [1440, 390]) {
    test(`the page header owns the period filter and discloses scope and timing through information at ${width}px`, async ({ page }) => {
      const records = DASHBOARD_USAGE_FIXTURE.records.map((row, index) => ({ ...row, approximate_tokens: [1000, 234, 0][index] }));
      await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/dashboard");
      await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
      const header = page.getByRole("heading", { name: "Overview", exact: true }).locator("xpath=ancestor::header[1]");
      const summary = page.getByRole("heading", { name: "Usage summary", exact: true }).locator("xpath=ancestor::section[1]");
      for (const name of ["All Time", "Last 6 Months", "Last 3 Months", "Last 1 Month"]) {
        await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
        await expect(summary.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
      await expect(page.getByText(/tokens have approximate timing/)).toHaveCount(0);
      const info = header.getByRole("button", { name: "Overview information", exact: true });
      if (width >= 1024) {
        await info.focus();
        await page.keyboard.press("Enter");
      } else {
        await info.click();
      }
      const disclosure = page.getByRole("dialog", { name: "Overview information", exact: true });
      await expect(disclosure).toBeVisible();
      await expect(disclosure).toContainText("Usage Summary, Salary Calculator, Trends and Insights");
      await expect(disclosure).toContainText("Activity and Goal Tracker always show 2026");
      await expect(disclosure).toContainText("Monthly Forecast and Daily Average always use this month");
      await expect(disclosure).toContainText("1,234 tokens have approximate timing");
      const box = (await disclosure.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(disclosure).not.toBeVisible();
      await expect(info).toBeFocused();
      await header.getByRole("button", { name: "Last 1 Month", exact: true }).click();
      await expect(page.getByText("No usage in this period.", { exact: true })).toBeVisible();
      await info.click();
      await expect(disclosure).toBeVisible();
      await expect(disclosure.getByText(/tokens have approximate timing/)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    });

    test(`daily stacked bars and the matching share chart switch dimensions at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/dashboard");
      const breakdown = page.getByRole("region", { name: "Usage breakdown", exact: true });
      const bar = breakdown.getByRole("figure", { name: "Daily token breakdown", exact: true });
      const share = breakdown.getByRole("figure", { name: "Token share", exact: true });
      await expect(bar.getByText("Daily Tokens by Model", { exact: true })).toBeVisible();
      await expect(share.getByText("1.8M tokens", { exact: true })).toBeVisible();
      await expect(bar.locator(".recharts-bar")).toHaveCount(1);
      await breakdown.getByRole("button", { name: "Harness", exact: true }).click();
      await expect(bar.getByText("Daily Tokens by Harness", { exact: true })).toBeVisible();
      await expect(share.getByText("Claude Code", { exact: true })).toBeVisible();
      await breakdown.getByRole("button", { name: "Device", exact: true }).click();
      await expect(bar.getByText("Daily Tokens by Device", { exact: true })).toBeVisible();
      await expect(share.getByText("Work Mac", { exact: true })).toBeVisible();
      await expect(share.getByText("Home Mac", { exact: true })).toBeVisible();
      await expect(share.getByText("1.8M tokens", { exact: true })).toBeVisible();
      await expect(bar.locator(".recharts-bar")).toHaveCount(2);
      const left = (await bar.boundingBox())!;
      const right = (await share.boundingBox())!;
      if (width >= 1024) {
        expect(Math.abs(left.y - right.y)).toBeLessThan(2);
        expect(Math.abs(left.height - right.height)).toBeLessThan(2);
        expect(right.x).toBeGreaterThan(left.x);
      } else {
        expect(right.y).toBeGreaterThan(left.y);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    });
  }

  test("the original overview highlights cache hit rate and removes the replacement view", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText(/100% read coverage/)).toBeVisible();
    await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
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

  test("the period selector bounds daily, hourly and device queries and keeps annual goals", async ({ page }) => {
    const requests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/usage" || url.pathname === "/api/usage/by-device") requests.push(url);
    });
    await page.goto("/dashboard");
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    const breakdown = page.getByRole("region", { name: "Usage breakdown", exact: true });
    await breakdown.getByRole("button", { name: "Device", exact: true }).click();
    await expect(breakdown.getByText("1.8M tokens", { exact: true })).toBeVisible();
    for (const [label, startMonth, hasUsage] of [["Last 6 Months", 2, true], ["Last 3 Months", 5, false], ["Last 1 Month", 7, false]] as const) {
      requests.length = 0;
      await page.getByRole("button", { name: label, exact: true }).click();
      if (hasUsage) await expect(stat(page, "Total Tokens").getByText("1.8M", { exact: true })).toBeVisible();
      else await expect(page.getByText("No usage in this period.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "All Time", exact: true })).toBeVisible();
      await expect(page.getByText("Ready to Track Your AI Usage")).not.toBeVisible();
      await expect(stat(page, "Cache Hit Rate").getByText(hasUsage ? "25.0%" : "—", { exact: true })).toBeVisible();
      const from = await page.evaluate((month) => new Date(2026, month, 15).toISOString(), startMonth);
      await expect.poll(() => requests.filter((url) => url.searchParams.get("from") === from).length).toBeGreaterThanOrEqual(3);
      const day = requests.find((url) => url.searchParams.get("granularity") === "day" && url.searchParams.get("from") === from);
      const hourly = requests.find((url) => url.searchParams.get("granularity") === "half-hour" && url.searchParams.get("from") === from);
      expect(day).toBeDefined();
      expect(hourly).toBeDefined();
      expect(day?.searchParams.get("to")).toBe(hourly?.searchParams.get("to"));
      await expect(breakdown.getByRole("button", { name: "Device", exact: true })).toHaveAttribute("aria-pressed", "true");
      if (hasUsage) await expect(breakdown.getByText("1.8M tokens", { exact: true })).toBeVisible();
      else await expect(breakdown.getByRole("figure", { name: "Daily token breakdown" }).getByText("No tokens to display.")).toBeVisible();
      const device = requests.find((url) => url.pathname === "/api/usage/by-device" && url.searchParams.get("from") === from);
      expect(device).toBeDefined();
      expect(device?.searchParams.get("to")).toBe(day?.searchParams.get("to"));
      await expect(page.getByRole("region", { name: "Activity", exact: true }).getByText("1.8M", { exact: true })).toBeVisible();
    }
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
      const cost = (await stat(page, "Est. Cost").boundingBox())!;
      if (width >= 1024) {
        expect(Math.abs(hit.y - total.y)).toBeLessThan(2);
        expect(hit.x).toBeGreaterThan(total.x);
        expect(hit.x).toBeLessThan(cost.x);
      } else {
        expect(hit.y).toBeGreaterThan(total.y);
        expect(hit.y).toBeLessThan(cost.y);
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
      const salary = page.getByRole("region", { name: "Salary calculator", exact: true });
      const trigger = salary.getByRole("button", { name: "Salary settings", exact: true });
      const monthly = salary.getByLabel("Monthly salary equivalent", { exact: true });
      await expect(monthly).toHaveText("$5");
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Salary settings", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/138 calendar days/)).toBeVisible();
      await expect(dialog.getByText("Huang Ratio", { exact: true })).toBeVisible();
      const slider = dialog.getByRole("slider").first();
      const before = await slider.getAttribute("aria-valuenow");
      await slider.focus();
      await page.keyboard.press("End");
      await expect(slider).not.toHaveAttribute("aria-valuenow", before!);
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width - 16);
      if (width >= 1024) expect(box.width).toBeGreaterThan(1000);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(monthly).toHaveText("$3");
      await trigger.click();
      await expect(slider).toHaveAttribute("aria-valuenow", "100");
      await dialog.getByRole("button", { name: "Close salary settings", exact: true }).click();
      await expect(monthly).toHaveText("$3");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    });
  }

  test("uncollected cache counts never become a zero-percent hit rate", async ({ page }) => {
    const records = DASHBOARD_USAGE_FIXTURE.records.map((row) => ({
      ...row, source: "hermes", cached_input_tokens: 0, input_tokens: 400_000,
    }));
    await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.goto("/dashboard");
    await expect(stat(page, "Cache Hit Rate").getByText("—", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText("Read counts unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg —", { exact: true })).toBeVisible();
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText(/Cache reads:.*unavailable/)).toBeVisible();
    await expect(page.getByText(/Cache writes:.*unavailable/)).toBeVisible();
    await expect(page.getByText(/Net cache savings:.*—/)).toBeVisible();
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
    await expect(stat(page, "Total Tokens").getByText("2.6M", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg 41.7%", { exact: true })).toBeVisible();
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText(/Cache reads:.*500.0K.*60%.*partial/i)).toBeVisible();
    await expect(page.getByText(/Cache writes:.*50.0K.*20%.*partial/i)).toBeVisible();
    await expect(page.getByRole("figure", { name: "Token share" }).getByText("2.6M tokens", { exact: true })).toBeVisible();
  });

  test("complete cache writes, a measured zero hit rate and negative net savings remain visible", async ({ page }) => {
    const record = annotatedRecord();
    const pricing = buildPricingMap({ dynamic: [{ model: `anthropic/${record.model}`, provider: "Anthropic", displayName: record.model,
      inputPerMillion: 3, outputPerMillion: 15, cachedPerMillion: 0.3, cacheWritePerMillion: 3.75,
      origin: "models.dev", route: "direct", contextWindow: 1_000_000, updatedAt: "2026-09-01T00:00:00Z" }] });
    await mockDashboardApis(page, { usage: { records: [record], summary: DASHBOARD_USAGE_FIXTURE.summary }, pricing });
    await page.goto("/dashboard");
    await expect(stat(page, "Cache Hit Rate").getByText("25.0%", { exact: true })).toBeVisible();
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText(/Cache reads:.*100.0K.*100%/)).toBeVisible();
    await expect(page.getByText(/Cache writes:.*50.0K.*100%/)).toBeVisible();
    await expect(page.getByText("Net cache savings: $0.23", { exact: false })).toBeVisible();

    const counts = record.accounting[0]!.groups[0]!.counts;
    counts.cache_read_input_tokens = 0;
    counts.cache_write_input_tokens = 400_000;
    counts.cache_write_5m_input_tokens = 400_000;
    await mockDashboardApis(page, { usage: { records: [record], summary: DASHBOARD_USAGE_FIXTURE.summary }, pricing });
    await page.reload();
    await expect(stat(page, "Cache Hit Rate").getByText("0.0%", { exact: true })).toBeVisible();
    await expect(stat(page, "Cache Hit Rate").getByText(/100% read coverage/)).toBeVisible();
    await expect(page.getByText("Avg 0.0%", { exact: true })).toBeVisible();
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText(/Net cache savings:.*-\$0\.30/)).toBeVisible();
  });

  test("device query failures offer retry and do not hide model or harness usage", async ({ page }) => {
    let unavailable = true;
    await page.route("**/api/usage/by-device?*", (route) => unavailable
      ? route.fulfill({ status: 500, json: { error: "Device query unavailable" } }) : route.fallback());
    await page.goto("/dashboard");
    const breakdown = page.getByRole("region", { name: "Usage breakdown", exact: true });
    await expect(breakdown.getByText("1.8M tokens", { exact: true })).toBeVisible();
    await breakdown.getByRole("button", { name: "Device", exact: true }).click();
    await expect(breakdown.getByText(/Failed to load device usage/)).toBeVisible();
    await expect(breakdown.getByRole("figure", { name: "Token share" }).getByText("Device usage unavailable")).toBeVisible();
    await breakdown.getByRole("button", { name: "Harness", exact: true }).click();
    await expect(breakdown.getByText("1.8M tokens", { exact: true })).toBeVisible();
    await breakdown.getByRole("button", { name: "Device", exact: true }).click();
    unavailable = false;
    await breakdown.getByRole("button", { name: "Retry device usage", exact: true }).click();
    await expect(breakdown.getByText("1.8M tokens", { exact: true })).toBeVisible();
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
    await expect(page.getByRole("region", { name: "Salary calculator", exact: true })).toHaveCount(0);
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

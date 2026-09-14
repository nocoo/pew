import {
  test, expect, DASHBOARD_USAGE_FIXTURE, DASHBOARD_USAGE_EMPTY_FIXTURE,
  DASHBOARD_PRICING_FIXTURE, mockDashboardApis,
} from "./fixtures";
import { buildPricingMap } from "../../src/lib/pricing";

test.describe("Feature: Overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await mockDashboardApis(page, { usage: DASHBOARD_USAGE_FIXTURE, pricing: DASHBOARD_PRICING_FIXTURE });
  });

  test("tokens, cost and cache control the same heatmap, line and breakdowns", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    const tokens = page.getByRole("button", { name: "Total Tokens", exact: true });
    await expect(tokens).toHaveAttribute("aria-pressed", "true");
    await expect(tokens.getByText("1.8M", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Activity heatmap" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily tokens", exact: true })).toBeVisible();
    for (const dimension of ["machine", "model", "harness"]) {
      await expect(page.getByRole("region", { name: `By ${dimension}`, exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Cost", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Daily estimated cost", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "By machine", exact: true }).getByText("$7.86", { exact: true })).toBeVisible();

    const cache = page.getByRole("button", { name: "Cache", exact: true });
    await cache.click();
    await expect(cache).toHaveAttribute("aria-pressed", "true");
    await expect(cache.getByText("300.0K", { exact: true }).first()).toBeVisible();
    await expect(cache.getByText("Write —", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily cache tokens", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "By machine", exact: true }).getByText("Partial", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Salary Estimator", { exact: true })).not.toBeVisible();
  });

  test("one period selector updates both queries and an empty period keeps controls available", async ({ page }) => {
    const requests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/usage" || url.pathname === "/api/usage/by-device") requests.push(url);
    });
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Total Tokens", exact: true })).toBeVisible();
    requests.length = 0;
    await page.getByRole("button", { name: "This Month", exact: true }).click();
    await expect(page.getByText("No usage in this period.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "All Time", exact: true })).toBeVisible();
    await expect(page.getByText("Ready to Track Your AI Usage")).not.toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.searchParams.get("from")).toBe(requests[1]?.searchParams.get("from"));
    expect(requests[0]?.searchParams.get("to")).toBe(requests[1]?.searchParams.get("to"));
  });

  for (const width of [1440, 390]) {
    test(`salary calculator opens in a large accessible dialog at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/dashboard");
      const trigger = page.getByRole("button", { name: "Salary calculator", exact: true });
      await expect(trigger).toBeEnabled();
      const heatmap = page.getByRole("region", { name: "Activity heatmap" });
      await heatmap.scrollIntoViewIfNeeded();
      await expect(heatmap.getByRole("img", { name: "2026-05-03: Tokens 600,000", exact: true })).toBeInViewport();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Salary calculator", exact: true });
      await expect(dialog).toBeVisible();
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
      await trigger.click();
      await dialog.getByRole("button", { name: "Close salary calculator" }).click();
      await expect(dialog).not.toBeVisible();
    });
  }

  test("unknown cache is unavailable in the card, heatmap and machine bars", async ({ page }) => {
    const records = DASHBOARD_USAGE_FIXTURE.records.map((row) => ({
      ...row, source: "hermes", cached_input_tokens: 0, input_tokens: 400_000,
    }));
    await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
    await page.goto("/dashboard");
    const cache = page.getByRole("button", { name: "Cache", exact: true });
    await cache.click();
    await expect(cache.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(cache.getByText("—", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Activity heatmap" }).getByRole("img", { name: /2026-05-01: Cache tokens unavailable/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "By machine", exact: true }).getByText("Unavailable", { exact: true }).first()).toBeVisible();
  });

  test("new clients display cache reads and writes throughout Overview", async ({ page }) => {
    const row = DASHBOARD_USAGE_FIXTURE.records[0];
    const basis = { input_tokens: row.input_tokens, cached_input_tokens: row.cached_input_tokens,
      output_tokens: row.output_tokens, reasoning_output_tokens: row.reasoning_output_tokens, total_tokens: row.total_tokens };
    const record = { ...row, accounting: [{ status: "matched", basis, groups: [{
      basis, counts: { input_total_tokens: 400_000, output_total_tokens: 200_000,
        cache_read_input_tokens: 100_000, cache_write_input_tokens: 50_000,
        cache_write_5m_input_tokens: 50_000, cache_write_1h_input_tokens: 0, reasoning_output_tokens: 50_000 },
      model: row.model, provider: "anthropic", route: "direct", service_tier: "default",
      origin: "claude:usage", quality: "reported", context_tokens_min: 400_000, context_tokens_max: 400_000,
      request_count: 1, diagnostics: [], reported_costs: [],
    }] }] };
    const pricing = buildPricingMap({ dynamic: [{ model: `anthropic/${row.model}`, provider: "Anthropic", displayName: row.model,
      inputPerMillion: 3, outputPerMillion: 15, cachedPerMillion: 0.3, cacheWritePerMillion: 3.75,
      origin: "models.dev", route: "direct", contextWindow: 1_000_000, updatedAt: "2026-09-01T00:00:00Z" }] });
    await mockDashboardApis(page, { usage: { records: [record], summary: basis }, pricing });
    await page.goto("/dashboard");
    const cache = page.getByRole("button", { name: "Cache", exact: true });
    await cache.click();
    await expect(cache.getByText("150.0K", { exact: true })).toBeVisible();
    await expect(cache.getByText("Read 100.0K", { exact: true })).toBeVisible();
    await expect(cache.getByText("Write 50.0K", { exact: true })).toBeVisible();
    await expect(cache.getByText("Complete counts", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Activity heatmap" }).getByRole("img", { name: "2026-05-01: Cache tokens 150,000", exact: true })).toBeVisible();
    for (const dimension of ["machine", "model", "harness"]) {
      await expect(page.getByRole("region", { name: `By ${dimension}`, exact: true }).getByText("150.0K", { exact: true })).toBeVisible();
    }
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText("Net cache savings: $0.23", { exact: false })).toBeVisible();

    const counts = record.accounting[0]!.groups[0]!.counts;
    counts.cache_read_input_tokens = 0;
    counts.cache_write_input_tokens = 400_000;
    counts.cache_write_5m_input_tokens = 400_000;
    await mockDashboardApis(page, { usage: { records: [record], summary: basis }, pricing });
    await page.reload();
    await page.getByText("Cache & cost details", { exact: true }).click();
    await expect(page.getByText("Net cache savings: -$0.30", { exact: false })).toBeVisible();
  });

  test("a machine request failure does not erase the other metrics", async ({ page }) => {
    await page.route("**/api/usage/by-device?*", (route) => route.fulfill({ status: 500, json: { error: "Machine data unavailable" } }));
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Total Tokens", exact: true }).getByText("1.8M", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "By machine", exact: true }).getByText(/Could not load machine usage/)).toBeVisible();
    await expect(page.getByRole("region", { name: "By model", exact: true })).toBeVisible();
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

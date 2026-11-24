import {
  test,
  expect,
  DASHBOARD_USAGE_FIXTURE,
  DASHBOARD_PRICING_FIXTURE,
  mockDashboardApis,
  watchPageReadiness,
} from "./fixtures";

test.describe("Feature: Compact usage information", () => {
  const pages = [
    ["/dashboard", "Overview information"],
    ["/devices", "Usage information"],
  ] as const;

  for (const [path, label] of pages) {
    test(`keeps explanatory text out of ${path} and offers hover/focus information`, async ({
      page,
    }) => {
      const now = new Date();
      await page.clock.setFixedTime(now);
      const records = DASHBOARD_USAGE_FIXTURE.records.map((row) => ({
        ...row,
        hour_start: new Date(now.getTime() - 60 * 60_000).toISOString(),
        approximate_tokens: 1644,
      }));
      await mockDashboardApis(page, {
        usage: { ...DASHBOARD_USAGE_FIXTURE, records },
        pricing: DASHBOARD_PRICING_FIXTURE,
      });
      if (path === "/devices") {
        await page.route("**/api/usage/by-device?*", (route) =>
          route.fulfill({
            json: {
              deviceDetails: records.map((row) => ({ ...row, device_id: "work" })),
              timeline: records.map((row) => ({
                ...row,
                date: now.toISOString().slice(0, 10),
                device_id: "work",
              })),
              devices: [
                {
                  ...records[0],
                  device_id: "work",
                  alias: "Work Mac",
                  sources: ["claude-code"],
                  models: [records[0]!.model],
                  first_seen: now.toISOString(),
                  last_seen: now.toISOString(),
                  estimated_cost: 1,
                },
              ],
            },
          }),
        );
      }
      const health = watchPageReadiness(page);
      await page.goto(path);
      await health.ready([
        path === "/devices" ? "/api/usage/by-device" : "/api/usage",
        "/api/pricing",
      ]);
      const trigger = page.getByRole("button", { name: label, exact: true });
      await expect(trigger).toBeVisible();
      await expect(
        page.getByText("Costs are estimates, not invoices.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          /tokens have approximate timing|Public price snapshot|hermes:none|reported amount|Cache & cost details/,
        ),
      ).toHaveCount(0);
      const main = page.locator("#main-content");
      const before = (await main.boundingBox())!;
      await trigger.hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toContainText("Costs are estimates, not invoices.");
      if (path !== "/devices")
        await expect(tooltip).toContainText("Some usage times are estimated");
      await expect(tooltip).not.toContainText("1,644");
      expect((await main.boundingBox())!.height).toBe(before.height);
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      await page.mouse.move(0, 0);
      await trigger.focus();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      await expect(trigger).toBeFocused();
      if (path === "/dashboard") {
        await page
          .getByRole("button", { name: "Salary estimate information", exact: true })
          .hover();
        await expect(tooltip).toContainText("not actual income");
        await page.keyboard.press("Escape");
      }
    });
  }

  test("supports tap and dismiss on a small screen without layout overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.clock.setFixedTime(new Date("2026-09-15T12:00:00Z"));
    await mockDashboardApis(page, {
      usage: DASHBOARD_USAGE_FIXTURE,
      pricing: DASHBOARD_PRICING_FIXTURE,
    });
    const health = watchPageReadiness(page);
    await page.goto("/dashboard");
    await health.ready(["/api/usage", "/api/pricing"]);
    await expect(page.getByRole("region", { name: "Activity", exact: true })).toContainText("1.8M");
    const trigger = page.getByRole("button", { name: "Overview information", exact: true });
    await trigger.click();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    const popup = page.locator("[data-radix-popper-content-wrapper]").filter({ has: tooltip });
    const box = (await popup.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeLessThanOrEqual(780);
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test("public profiles offer a compact information control without billing diagnostics", async ({
    page,
  }) => {
    await mockDashboardApis(page, {
      usage: DASHBOARD_USAGE_FIXTURE,
      pricing: DASHBOARD_PRICING_FIXTURE,
    });
    await page.route("**/api/users/info-fixture?*", (route) =>
      route.fulfill({
        json: {
          user: {
            name: "Profile Fixture",
            nickname: null,
            image: null,
            slug: "info-fixture",
            created_at: "2026-01-01",
            first_seen: "2026-01-01",
          },
          ...DASHBOARD_USAGE_FIXTURE,
          records: DASHBOARD_USAGE_FIXTURE.records.map((row) => ({
            ...row,
            approximate_tokens: 1644,
          })),
        },
      }),
    );
    const health = watchPageReadiness(page);
    await page.goto("/u/info-fixture");
    await health.ready(["/api/users/info-fixture", "/api/pricing"]);
    const trigger = page.getByRole("button", { name: "Usage information", exact: true });
    await expect(trigger).toBeVisible();
    await expect(
      page.getByText(
        /Usage, cache.*cost details|Public price snapshot|tokens have approximate timing/,
      ),
    ).toHaveCount(0);
    await trigger.hover();
    await expect(page.getByRole("tooltip")).toContainText("Some usage times are estimated");
  });

  test("model prices hide backend state and error details while retaining freshness guidance", async ({
    page,
  }) => {
    await mockDashboardApis(page, {
      usage: DASHBOARD_USAGE_FIXTURE,
      pricing: DASHBOARD_PRICING_FIXTURE,
    });
    await page.route("**/api/pricing/models", (route) =>
      route.fulfill({
        json: {
          entries: [
            {
              model: "test/model",
              provider: "Test",
              displayName: "Test Model",
              origin: "baseline",
              updatedAt: "2026-01-01",
              inputPerMillion: 1,
              outputPerMillion: 2,
              cachedPerMillion: 0.1,
              contextWindow: 100_000,
              contextTiers: [
                {
                  minInputTokens: 200_000,
                  inputPerMillion: 2,
                  outputPerMillion: 4,
                  cachedPerMillion: 0.2,
                },
              ],
            },
          ],
          servedFrom: "baseline",
          meta: {
            lastSyncedAt: "2026-01-01",
            modelCount: 1,
            baselineCount: 0,
            openRouterCount: 0,
            modelsDevCount: 0,
            lastErrors: [{ source: "kv", message: "PRIVATE_BACKEND_ERROR", at: "2026-01-01" }],
          },
        },
      }),
    );
    const health = watchPageReadiness(page);
    await page.goto("/model-prices");
    await health.ready(["/api/pricing/models"]);
    await expect(page.getByText("Test Model", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/worker-read|baseline JSON|KV cache|PRIVATE_BACKEND_ERROR|Last synced:/),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Model price information", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Some prices may be out of date");
    await expect(page.getByRole("tooltip")).not.toContainText("PRIVATE_BACKEND_ERROR");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Additional prices for test/model", exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toContainText("Input ≥ 200,000");
    await expect(page.locator("details")).toHaveCount(0);
  });
});

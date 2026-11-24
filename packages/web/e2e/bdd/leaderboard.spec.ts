import {
  test,
  expect,
  mockDashboardApis,
  DASHBOARD_PRICING_FIXTURE,
  watchPageReadiness,
} from "./fixtures";

test("period and harness navigation refetch populated rankings", async ({ page }) => {
  const health = watchPageReadiness(page);
  await page.goto("/leaderboard");
  await health.ready(["/api/leaderboard?period=week"]);
  await expect(page.getByText("E2E Test User", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Last 30 Days" }).click();
  await health.ready(["/api/leaderboard?period=month"]);
  await expect(page.getByText("1,800,000", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "All Time" }).click();
  await health.ready(["/api/leaderboard?period=all"]);
  await expect(page.getByText("Readiness Peer", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Harness", exact: true }).click();
  await health.ready(["/api/leaderboard?source=claude-code"]);
  await expect(page.getByText("900,000", { exact: true })).toHaveCount(2);
});

test("Antigravity is selectable with its own source filter on desktop and mobile", async ({
  page,
}) => {
  for (const width of [1440]) {
    await page.setViewportSize({ width, height: 900 });
    const health = watchPageReadiness(page);
    await page.goto("/leaderboard/harness?source=antigravity");
    await health.ready(["/api/leaderboard?source=antigravity"]);
    await expect(page.getByRole("button", { name: "Antigravity" })).toBeVisible();
    await page.getByRole("button", { name: "Antigravity" }).click();
    await expect(page.getByRole("menuitem")).toHaveCount(15);
    for (const name of [
      "Gemini CLI",
      "Kosmos",
      "Oh My Pi",
      "ZCode",
      "PM Studio",
      "VS Code Copilot",
    ]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.goto("/leaderboard/harness?source=zcode");
    await health.ready(["/api/leaderboard?source=zcode"]);
    await expect(page.getByRole("button", { name: "ZCode", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    health.dispose();
  }
});

test("landing page advertises only the nine active collectors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Antigravity", { exact: true })).toBeVisible();
  for (const name of [
    "Gemini CLI",
    "Kosmos",
    "Oh My Pi",
    "ZCode",
    "PM Studio",
    "VS Code Copilot",
  ]) {
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
});

test("dashboard and agents pages display Antigravity source and models", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
  await mockDashboardApis(page, {
    usage: {
      records: [
        {
          source: "antigravity",
          model: "gemini-4-neon",
          hour_start: "2026-10-01T12:00:00.000Z",
          input_tokens: 1500,
          cached_input_tokens: 500,
          output_tokens: 300,
          reasoning_output_tokens: 200,
          total_tokens: 2500,
        },
      ],
      summary: {
        total_tokens: 2500,
        input_tokens: 1500,
        cached_input_tokens: 500,
        output_tokens: 300,
        reasoning_output_tokens: 200,
      },
    },
    pricing: DASHBOARD_PRICING_FIXTURE,
  });

  await page.goto("/dashboard");
  const breakdown = page.getByRole("region", { name: "Usage breakdown", exact: true });
  const share = breakdown.getByRole("figure", { name: "Token share", exact: true });
  await breakdown.getByRole("button", { name: "Harness", exact: true }).click();
  await expect(share.getByText("Antigravity", { exact: true })).toBeVisible();

  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Antigravity", exact: true })).toBeVisible();
  await expect(page.getByText("gemini-4-neon", { exact: true })).toBeVisible();
});

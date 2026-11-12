import { VALID_SOURCES } from "@pew/core";

import { test, expect, watchPageReadiness } from "./fixtures";

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

test("Antigravity is selectable with its own source filter on desktop and mobile", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const health = watchPageReadiness(page);
    await page.goto("/leaderboard/harness?source=antigravity");
    await health.ready(["/api/leaderboard?source=antigravity"]);
    await expect(page.getByRole("button", { name: "Antigravity CLI" })).toBeVisible();
    await page.getByRole("button", { name: "Antigravity CLI" }).click();
    // The dropdown lists every readable source (active + retired); derive the
    // count from core so adding a source doesn't silently stale this gate.
    await expect(page.getByRole("menuitem")).toHaveCount(VALID_SOURCES.size);
    // Count alone can't tell the new source from a duplicate label, so pin
    // WorkBuddy's own entry explicitly alongside the retired sources.
    for (const name of ["WorkBuddy", "Gemini CLI", "Kosmos", "Oh My Pi", "ZCode", "PM Studio", "VS Code Copilot"]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.goto("/leaderboard/harness?source=zcode");
    await health.ready(["/api/leaderboard?source=zcode"]);
    await expect(page.getByRole("button", { name: "ZCode", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    health.dispose();
  }
});

// The landing page advertises the active collector list only; retired
// sources must never surface there.
test("landing page advertises only the active collectors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Antigravity CLI", { exact: true })).toBeVisible();
  for (const name of ["Gemini CLI", "Kosmos", "Oh My Pi", "ZCode", "PM Studio", "VS Code Copilot"]) {
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
});

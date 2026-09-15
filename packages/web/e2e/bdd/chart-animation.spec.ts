import type { Page } from "@playwright/test";
import { test, expect, DASHBOARD_USAGE_FIXTURE, DASHBOARD_PRICING_FIXTURE, mockDashboardApis } from "./fixtures";

const playback = (page: Page) => page.locator("html");
const pausedStyle = /--chart-animation-play-state:\s*paused/;
const series = (page: Page) => [
  page.locator(".recharts-area").first(),
  page.getByRole("figure", { name: "Daily token breakdown" }).locator(".recharts-bar").first(),
  page.getByRole("figure", { name: "Token share" }).locator(".recharts-pie").first(),
  page.getByRole("region", { name: "Salary calculator", exact: true }).locator(".recharts-line").first(),
];
const frames = (page: Page) => Promise.all(series(page).map((chart) => chart.evaluate((node) => node.outerHTML)));

test.describe("Feature: Shared chart animation", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
    const records = [...DASHBOARD_USAGE_FIXTURE.records, ...DASHBOARD_USAGE_FIXTURE.records.map((row, i) => ({
      ...row, model: i === 0 ? "gpt-5.4" : row.model, hour_start: row.hour_start.replace("2026-05", "2026-09"),
      input_tokens: row.input_tokens * (i + 2), total_tokens: row.total_tokens + row.input_tokens * (i + 1),
    }))];
    await mockDashboardApis(page, { usage: { ...DASHBOARD_USAGE_FIXTURE, records }, pricing: DASHBOARD_PRICING_FIXTURE });
  });

  test("CSS visualizations share duration, easing and delay", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".chart-animate").first()).toBeAttached();
    const styles = await page.locator(".chart-animate").evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return [style.animationDuration, style.animationTimingFunction, style.animationDelay];
    }));
    expect(styles.length).toBeGreaterThan(700);
    for (const style of styles) expect(style).toEqual(["0.5s", "ease-out", "0s"]);
  });

  test("old and new series animate, pause together and finish after rapid sidebar toggles", async ({ page }) => {
    await page.goto("/dashboard");
    for (const chart of series(page)) await expect(chart).toBeAttached();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.clock.runFor(600);
    await page.getByRole("button", { name: "Last 1 Month", exact: true }).click();
    await expect(page.getByRole("figure", { name: "Token share" })).toContainText("3.6M tokens");
    await page.clock.runFor(96);
    const early = await frames(page);
    await page.clock.runFor(96);
    const progressing = await frames(page);
    for (let i = 0; i < early.length; i++) expect(progressing[i]).not.toBe(early[i]);

    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(playback(page)).toHaveAttribute("style", pausedStyle);
    const frozen = await frames(page);
    const css = page.locator(".chart-grow-x.bg-chart-2");
    await expect(css).toHaveCSS("animation-play-state", "paused");
    const cssTime = await css.evaluate((node) => Number(node.getAnimations()[0]!.currentTime));
    await page.clock.runFor(128);
    expect(await frames(page)).toEqual(frozen);

    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    // CSS layout transitions use the compositor clock, outside Playwright's JS clock.
    await page.waitForTimeout(350);
    expect(await css.evaluate((node) => Number(node.getAnimations()[0]!.currentTime))).toBeCloseTo(cssTime);
    await page.clock.runFor(500);
    await expect(playback(page)).toHaveAttribute("style", pausedStyle);
    await page.clock.runFor(150);
    await expect(css).toHaveCSS("animation-play-state", "running");
    await page.waitForTimeout(50);
    await page.clock.runFor(550);
    const finished = await frames(page);
    await page.clock.runFor(150);
    expect(await frames(page)).toEqual(finished);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  });

  test("mobile navigation pauses charts on opening, dismissing and navigating", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(playback(page)).toHaveAttribute("style", pausedStyle);
    await page.clock.runFor(650);
    await expect(playback(page)).not.toHaveAttribute("style", pausedStyle);
    await page.keyboard.press("Escape");
    await expect(playback(page)).toHaveAttribute("style", pausedStyle);
    await page.clock.runFor(650);
    await expect(playback(page)).not.toHaveAttribute("style", pausedStyle);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.clock.runFor(650);
    await page.getByRole("dialog", { name: "Navigation", exact: true }).getByRole("button", { name: "By Model", exact: true }).click();
    await expect(playback(page)).toHaveAttribute("style", pausedStyle);
    await page.clock.runFor(650);
    await expect(playback(page)).not.toHaveAttribute("style", pausedStyle);
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("reduced motion shows complete charts without data animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    for (const chart of series(page)) await expect(chart).toBeAttached();
    await expect(page.locator(".chart-animate").first()).toHaveCSS("animation-name", "none");
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const before = await frames(page);
    await page.clock.runFor(250);
    expect(await frames(page)).toEqual(before);
    for (const chart of series(page)) await expect(chart.locator("path").first()).toBeVisible();
    await page.getByRole("button", { name: "Salary settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Salary settings", exact: true }).locator(".recharts-line").first()).toBeVisible();
  });

  test("salary charts mounted in a portal during a pause wait, then animate with the page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Salary settings", exact: true })).toBeEnabled();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await page.getByRole("button", { name: "Salary settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Salary settings", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".recharts-line")).toHaveCount(0);
    await page.waitForTimeout(350);
    await page.clock.runFor(650);
    await expect(dialog.locator(".recharts-line")).toHaveCount(3);
    await page.waitForTimeout(50);
    await page.clock.runFor(96);
    const line = dialog.locator(".recharts-line").first();
    const early = await line.evaluate((node) => node.outerHTML);
    await page.clock.runFor(96);
    expect(await line.evaluate((node) => node.outerHTML)).not.toBe(early);
    await page.clock.runFor(550);
    const finished = await line.evaluate((node) => node.outerHTML);
    await page.clock.runFor(150);
    expect(await line.evaluate((node) => node.outerHTML)).toBe(finished);
    expect(await dialog.locator(".recharts-responsive-container").evaluate((node) =>
      Math.abs(node.clientWidth - node.querySelector(".recharts-wrapper")!.clientWidth))).toBeLessThan(1);
  });
});

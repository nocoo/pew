import type { Page } from "@playwright/test";
import {
  test, expect, DASHBOARD_USAGE_FIXTURE, DASHBOARD_PRICING_FIXTURE, mockDashboardApis,
} from "./fixtures";

const title = "升级 Pew CLI 至 3.0";
const noticePath = "**/api/cli-upgrade-notice";

async function dashboard(page: Page) {
  await mockDashboardApis(page, { usage: DASHBOARD_USAGE_FIXTURE, pricing: DASHBOARD_PRICING_FIXTURE });
}

test.describe("CLI upgrade notice", () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test(`shows copyable npm/Bun commands and both mirrors on a glass mask at ${viewport.width}px`, async ({ page, context }) => {
      await page.setViewportSize(viewport);
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await dashboard(page);
      let claims = 0;
      await page.route(noticePath, (route) => route.fulfill({ json: { show: ++claims === 1 } }));
      await page.goto("/dashboard");
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      expect(claims).toBe(1);
      await test.info().attach(`upgrade-notice-${viewport.width}`, {
        body: await page.screenshot({ animations: "disabled" }), contentType: "image/png",
      });
      await expect(dialog).toContainText("低于 3.0.0 的版本将无法上传用量");
      await expect(dialog.getByText("npm install -g @nocoo/pew@latest", { exact: true })).toBeVisible();
      await expect(dialog.getByText("bun add -g @nocoo/pew@latest", { exact: true })).toBeVisible();
      await dialog.getByRole("group", { name: "npm", exact: true }).getByRole("button").click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm install -g @nocoo/pew@latest");
      await dialog.getByText("主镜像连接不畅？使用国内镜像", { exact: true }).click();
      for (const registry of ["https://mirrors.cloud.tencent.com/npm/", "https://repo.huaweicloud.com/repository/npm/"]) {
        for (const command of ["npm install -g", "bun add -g"]) {
          const text = `${command} @nocoo/pew@latest --registry=${registry}`;
          await expect(dialog.getByText(text, { exact: true })).toBeVisible();
        }
      }
      await expect(dialog.getByText("pew --version && pew sync", { exact: true })).toBeVisible();
      await expect(dialog).not.toContainText("pew reset");
      const blur = await page.locator("[data-state='open']").evaluateAll((elements) =>
        elements.some((element) => {
          const style = getComputedStyle(element);
          return style.position === "fixed" && style.backdropFilter.includes("blur(");
        }),
      );
      expect(blur).toBe(true);
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeLessThanOrEqual(viewport.height - 16);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await dialog.getByRole("button", { name: "跳过且以后不再显示", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await page.reload();
      await expect.poll(() => claims).toBe(2);
      await expect(dialog).not.toBeVisible();
    });
  }

  test("does not reopen when an already-seen account logs in", async ({ page }) => {
    await dashboard(page);
    await page.route(noticePath, (route) => route.fulfill({ json: { show: false } }));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: title })).not.toBeVisible();
  });

  test("does not ask anonymous users to claim the notice", async ({ page }) => {
    await dashboard(page);
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: {} }));
    let claims = 0;
    await page.route(noticePath, (route) => { claims++; return route.fulfill({ json: { show: true } }); });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: title })).not.toBeVisible();
    expect(claims).toBe(0);
  });

  test("supports keyboard dismissal and leaves the dashboard usable if the notice service fails", async ({ page }) => {
    await dashboard(page);
    await page.route(noticePath, (route) => route.fulfill({ json: { show: true } }));
    await page.goto("/dashboard");
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: title })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.route(noticePath, (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(dialog).not.toBeVisible();
  });
});

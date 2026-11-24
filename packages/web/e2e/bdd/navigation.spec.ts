import {
  test,
  expect,
  mockDashboardApis,
  DASHBOARD_USAGE_EMPTY_FIXTURE,
  DASHBOARD_PRICING_FIXTURE,
} from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockDashboardApis(page, {
    usage: DASHBOARD_USAGE_EMPTY_FIXTURE,
    pricing: DASHBOARD_PRICING_FIXTURE,
  });
});

test("mobile navigation fits its drawer at the small breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto("/dashboard");
  const opener = page.getByRole("button", { name: "Open navigation", exact: true });
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await opener.click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS("padding", "0px");
  expect(
    await drawer.evaluate((element) => {
      const outer = element.getBoundingClientRect();
      const sidebar = element.querySelector("[data-basalt-sidebar]")!.getBoundingClientRect();
      return sidebar.left >= outer.left && sidebar.right <= outer.right;
    }),
  ).toBe(true);
  await expect(drawer.getByRole("button", { name: "Sign out", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await drawer.getByRole("button", { name: "By Model", exact: true }).click();
  await expect(page).toHaveURL(/\/models$/);
  await expect(drawer).not.toBeVisible();
});

for (const action of ["Get Started", "Go to Seasons"] as const) {
  test(`${action} preserves dashboard chrome without document navigation`, async ({ page }) => {
    let showAlert = () => {};
    const ready = new Promise<void>((resolve) => {
      showAlert = resolve;
    });
    if (action === "Go to Seasons") {
      await page.route("**/api/admin/check", (route) => route.fulfill({ json: { isAdmin: true } }));
      await page.route("**/api/admin/seasons", (route) => route.fulfill({ json: { seasons: [] } }));
      await page.route("**/api/seasons?status=ended", async (route) => {
        await ready;
        await route.fulfill({
          json: {
            seasons: [
              {
                id: "navigation-season",
                name: "Navigation season",
                slug: "navigation-season",
                start_date: "2026-01-01T00:00:00Z",
                end_date: "2026-02-01T00:00:00Z",
                status: "ended",
                team_count: 0,
                has_snapshot: false,
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        });
      });
    }
    try {
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      const nodes = await page
        .locator(
          "[data-basalt-shell], [data-basalt-header], [data-basalt-main], [data-basalt-sidebar]",
        )
        .elementHandles();
      expect(nodes.length).toBeGreaterThanOrEqual(4);
      const documents: string[] = [];
      page.on("request", (request) => {
        if (request.resourceType() === "document") documents.push(request.url());
      });
      showAlert();
      await page.getByRole("link", { name: action, exact: true }).click();
      await expect(page).toHaveURL(action === "Get Started" ? /\/agents$/ : /\/admin\/seasons$/);
      await expect(page.getByRole("heading", { level: 1 }).last()).toContainText(
        action === "Get Started" ? "By Agent" : "Seasons",
      );
      expect(documents).toEqual([]);
      await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
      for (const node of nodes) {
        expect(await node.evaluate((element) => element.isConnected)).toBe(true);
        expect(await node.isVisible()).toBe(true);
      }
      await page.goBack();
      await expect(page).toHaveURL(/\/dashboard$/);
      if (action === "Go to Seasons") {
        await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      }
      await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
      for (const node of nodes) {
        expect(await node.evaluate((element) => element.isConnected)).toBe(true);
      }
      expect(documents).toEqual([]);
    } finally {
      showAlert();
    }
  });
}

test("public privacy links and home return use client navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  await page.getByRole("link", { name: "Privacy policy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy", exact: true })).toBeVisible();
  expect(documents).toEqual([]);
  await page.getByRole("link", { name: "Back to home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  expect(documents).toEqual([]);
});

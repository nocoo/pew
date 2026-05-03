import { test, expect } from "@playwright/test";

function randomBadgeText(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const len = 2 + Math.floor(Math.random() * 2); // 2 or 3 chars
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

test.describe("admin badges CRUD", () => {
  test.describe.configure({ mode: "serial" });

  const badgeText = randomBadgeText();
  const badgeId = `test-badge-${Date.now()}`;
  const badges: Record<string, unknown>[] = [];

  test("creates a badge via dialog", async ({ page }) => {
    await page.route("**/api/admin/badges", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ badges }),
        });
      }
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        const badge = {
          id: badgeId,
          text: body.text,
          icon: body.icon,
          color_bg: "#3B82F6",
          color_text: "#FFFFFF",
          description: body.description || null,
          is_archived: 0,
          created_at: new Date().toISOString(),
        };
        badges.push(badge);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ badge }),
        });
      }
    });
    await page.route("**/api/admin/badges/assignments*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assignments: [] }),
      }),
    );

    await page.goto("/admin/badges");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Badge",
    );

    await page.getByRole("button", { name: "Create Badge" }).click();

    await page.getByPlaceholder("MVP").fill(badgeText);
    await page.getByRole("button", { name: "Shield" }).click();
    await page.getByRole("button", { name: "Ocean" }).click();

    const createBtn = page.getByRole("button", { name: "Create", exact: true });
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    await createBtn.click();

    await expect(page.getByText(badgeText).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("archives a badge", async ({ page }) => {
    await page.route("**/api/admin/badges", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ badges }),
        });
      }
    });
    await page.route("**/api/admin/badges/assignments*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assignments: [] }),
      }),
    );
    await page.route(`**/api/admin/badges/${badgeId}/archive`, async (route) => {
      if (route.request().method() === "POST") {
        const badge = badges.find((b) => b.id === badgeId);
        if (badge) badge.is_archived = 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.goto("/admin/badges");
    await expect(page.getByText(badgeText).first()).toBeVisible({
      timeout: 10_000,
    });

    const badgeRow = page
      .locator("div")
      .filter({ hasText: badgeText })
      .filter({ has: page.getByRole("button", { name: "Archive" }) });
    await badgeRow
      .first()
      .getByRole("button", { name: "Archive" })
      .click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Archive" }).click();

    await expect(
      page.getByRole("button", { name: "Unarchive" }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

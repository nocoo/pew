// Covers old: admin.spec.ts, admin-badges-crud.spec.ts, admin-seasons-crud.spec.ts
import { test, expect } from "./fixtures";

const ADMIN_HEADING_PAGES: ReadonlyArray<{ path: string; keyword: string }> = [
  { path: "/admin/badges", keyword: "Badge" },
  { path: "/admin/invites", keyword: "Invite" },
  { path: "/admin/model-prices", keyword: "Model Prices" },
  { path: "/admin/seasons", keyword: "Season" },
  { path: "/admin/storage", keyword: "Storage" },
];

function randomBadgeText(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const len = 2 + Math.floor(Math.random() * 2); // 2 or 3 chars
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

test.describe("Feature: Admin", () => {
  test.describe("page loads", () => {
    for (const { path, keyword } of ADMIN_HEADING_PAGES) {
      test(`Given auth is bypassed, When I visit ${path}, Then the heading contains "${keyword}"`, async ({ page }) => {
        // Given: E2E_SKIP_AUTH=true is set by the runner
        // When: navigate to the admin sub-page
        await page.goto(path);
        // Then: top-level heading contains the expected keyword
        await expect(page.getByRole("heading", { level: 1 })).toContainText(keyword);
      });
    }

    test("Given auth is bypassed, When I visit /admin/compare and /admin/compare/result, Then both render the Compare heading", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit the compare landing page
      await page.goto("/admin/compare");
      // Then: Compare heading is visible (covers old: admin.spec.ts "compare page loads")
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Compare");
      // When: visit the compare result page
      await page.goto("/admin/compare/result");
      // Then: Compare heading is visible (covers old: admin.spec.ts "compare result page loads")
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Compare");
    });

    test("Given auth is bypassed, When I visit /admin/showcases, Then the main content area is visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit the showcases admin page
      await page.goto("/admin/showcases");
      // Then: main content area renders (this page has no level-1 heading, so the
      // original spec asserted main visibility instead — keep the same assertion)
      await expect(page.locator("main")).toBeVisible();
    });
  });

  test.describe("Badges CRUD", () => {
    // Serial mode preserved from admin-badges-crud.spec.ts — the second scenario
    // depends on the badge created by the first scenario in shared module-level state.
    test.describe.configure({ mode: "serial" });

    const badgeText = randomBadgeText();
    const badgeId = `test-badge-${Date.now()}`;
    const badges: Record<string, unknown>[] = [];

    test("Given a route-mocked badges API, When I create a badge via the dialog, Then the new badge text becomes visible", async ({ page }) => {
      // Given: route-mocked /api/admin/badges with in-memory list, plus empty assignments
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

      // When: open /admin/badges, click Create Badge, fill the dialog, submit
      await page.goto("/admin/badges");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Badge");
      await page.getByRole("button", { name: "Create Badge" }).click();
      await page.getByPlaceholder("MVP").fill(badgeText);
      await page.getByRole("button", { name: "Shield" }).click();
      await page.getByRole("button", { name: "Ocean" }).click();
      const createBtn = page.getByRole("button", { name: "Create", exact: true });
      await expect(createBtn).toBeEnabled({ timeout: 5_000 });
      await createBtn.click();

      // Then: the new badge text becomes visible in the list
      await expect(page.getByText(badgeText).first()).toBeVisible({ timeout: 10_000 });
    });

    test("Given the badge created in the previous scenario, When I archive it via the confirm dialog, Then the Unarchive button becomes visible", async ({ page }) => {
      // Given: route-mocked badges GET + assignments + archive POST; the badge from
      // the previous scenario is still in the shared in-memory `badges` list (serial mode)
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

      // When: open /admin/badges, click the row's Archive button, confirm in dialog
      await page.goto("/admin/badges");
      await expect(page.getByText(badgeText).first()).toBeVisible({ timeout: 10_000 });
      const badgeRow = page
        .locator("div")
        .filter({ hasText: badgeText })
        .filter({ has: page.getByRole("button", { name: "Archive" }) });
      await badgeRow.first().getByRole("button", { name: "Archive" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Archive" }).click();

      // Then: the row now shows an Unarchive button (state flipped)
      await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible({
        timeout: 10_000,
      });
    });
  });

  test.describe("Seasons CRUD", () => {
    // Serial mode preserved from admin-seasons-crud.spec.ts — the edit scenario
    // operates on the season created by the previous scenario in shared state.
    test.describe.configure({ mode: "serial" });

    const suffix = Date.now();
    const seasonName = `E2E Season ${suffix}`;
    const seasonSlug = `e2e-${suffix}`;
    const updatedName = `E2E Edited ${suffix}`;
    const seasonId = `test-season-${suffix}`;
    const seasons: Record<string, unknown>[] = [];

    test("Given a route-mocked seasons API, When I create a season via the form, Then the new name and slug become visible", async ({ page }) => {
      // Given: route-mocked /api/admin/seasons with in-memory list
      await page.route("**/api/admin/seasons", async (route) => {
        if (route.request().method() === "GET") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ seasons }),
          });
        }
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          const season = {
            id: seasonId,
            name: body.name,
            slug: body.slug,
            start_date: body.start_date,
            end_date: body.end_date,
            status: "upcoming",
            team_count: 0,
            created_at: new Date().toISOString(),
            allow_late_registration: body.allow_late_registration ?? false,
            allow_roster_changes: body.allow_roster_changes ?? false,
            allow_late_withdrawal: body.allow_late_withdrawal ?? false,
          };
          seasons.push(season);
          return route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify(season),
          });
        }
      });

      // When: open /admin/seasons, click Create Season, fill name/slug/start/end, submit
      await page.goto("/admin/seasons");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Season");
      await page.getByRole("button", { name: "Create Season" }).click();
      await page.getByPlaceholder("Season 1").fill(seasonName);
      await page.getByPlaceholder("season-1").fill(seasonSlug);
      // datetime-local inputs have no Playwright role helper; positional CSS
      // selectors (.nth(0)/.nth(1)) are used here for the same reason as the
      // original spec — there is no accessible label on these two inputs.
      const startInput = page.locator('input[type="datetime-local"]').nth(0);
      const endInput = page.locator('input[type="datetime-local"]').nth(1);
      await startInput.fill("2027-01-01T00:00");
      await endInput.fill("2027-06-30T23:59");
      await page.getByRole("button", { name: "Create", exact: true }).click();

      // Then: new season name and slug both render
      await expect(page.getByText(seasonName, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(seasonSlug)).toBeVisible();
    });

    test("Given the season created in the previous scenario, When I edit its name inline and save, Then the updated name becomes visible", async ({ page }) => {
      // Given: route-mocked GET + PATCH; the season from the previous scenario is
      // still in the shared in-memory `seasons` list (serial mode)
      await page.route("**/api/admin/seasons", async (route) => {
        if (route.request().method() === "GET") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ seasons }),
          });
        }
      });
      await page.route(`**/api/admin/seasons/${seasonId}`, async (route) => {
        if (route.request().method() === "PATCH") {
          const body = route.request().postDataJSON();
          seasons[0] = { ...seasons[0], ...body };
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(seasons[0]),
          });
        }
      });

      // When: open /admin/seasons, enter edit mode on the row, change name, save
      await page.goto("/admin/seasons");
      await expect(page.getByText(seasonName)).toBeVisible({ timeout: 10_000 });
      const row = page.locator("tr", { hasText: seasonName });
      // [title="Edit season"] CSS selector is used because the edit icon button
      // exposes its meaning only via the title attribute, same as the original spec.
      await row.locator('[title="Edit season"]').click();
      const editRow = page.locator("tr", {
        has: page.getByRole("button", { name: "Save" }),
      });
      // The first text input in the row corresponds to the season name; there is
      // no accessible label distinguishing it from the slug input in inline-edit mode.
      const nameInput = editRow.locator('input[type="text"]').first();
      await nameInput.clear();
      await nameInput.fill(updatedName);
      await page.getByRole("button", { name: "Save" }).click();

      // Then: the updated name renders
      await expect(page.getByText(updatedName, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});

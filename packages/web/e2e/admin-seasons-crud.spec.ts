import { test, expect } from "@playwright/test";

test.describe("admin seasons CRUD", () => {
  test.describe.configure({ mode: "serial" });

  const suffix = Date.now();
  const seasonName = `E2E Season ${suffix}`;
  const seasonSlug = `e2e-${suffix}`;
  const updatedName = `E2E Edited ${suffix}`;
  const seasonId = `test-season-${suffix}`;

  const seasons: Record<string, unknown>[] = [];

  test("creates a new season", async ({ page }) => {
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

    await page.goto("/admin/seasons");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Season",
    );

    await page.getByRole("button", { name: "Create Season" }).click();

    await page.getByPlaceholder("Season 1").fill(seasonName);
    await page.getByPlaceholder("season-1").fill(seasonSlug);

    const startInput = page.locator('input[type="datetime-local"]').nth(0);
    const endInput = page.locator('input[type="datetime-local"]').nth(1);
    await startInput.fill("2027-01-01T00:00");
    await endInput.fill("2027-06-30T23:59");

    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(
      page.getByText(seasonName, { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(seasonSlug)).toBeVisible();
  });

  test("edits an existing season name", async ({ page }) => {
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

    await page.goto("/admin/seasons");
    await expect(page.getByText(seasonName)).toBeVisible({ timeout: 10_000 });

    const row = page.locator("tr", { hasText: seasonName });
    await row.locator('[title="Edit season"]').click();

    const editRow = page.locator("tr", {
      has: page.getByRole("button", { name: "Save" }),
    });
    const nameInput = editRow.locator('input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill(updatedName);

    await page.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText(updatedName, { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

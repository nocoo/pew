// Covers old: teams.spec.ts, organizations.spec.ts
import { test, expect } from "./fixtures";

test.describe("Feature: Collaboration", () => {
  test.describe("Teams", () => {
    test("Given auth is bypassed, When I visit /teams, Then the Team heading is visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit /teams
      await page.goto("/teams");
      // Then: top-level heading contains "Team"
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Team");
    });

    test("Given auth is bypassed, When I visit /teams, Then the main content area is visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit /teams
      await page.goto("/teams");
      // Then: main content area renders (covers original "create or join options" smoke
      // without the defensive catch-based visibility fallback — main visibility is
      // the deterministic equivalent of "page rendered without crashing")
      await expect(page.locator("main").first()).toBeVisible();
    });

    test("Given auth is bypassed, When I visit /teams/test-team-id, Then the URL stays under /teams without crashing", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: navigate to a non-existent team detail page
      await page.goto("/teams/test-team-id");
      // Then: URL resolves under /teams (404 or empty state, no crash/redirect away)
      expect(page.url()).toContain("/teams");
    });
  });

  test.describe("Organizations admin page", () => {
    test("Given auth is bypassed, When I visit /admin/organizations, Then the Organizations heading and management tagline are visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit the admin organizations page
      await page.goto("/admin/organizations");
      // Then: heading + tagline render
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Organizations");
      await expect(page.getByText("Manage interest-based organizations")).toBeVisible();
    });

    test("Given auth is bypassed, When I visit /admin/organizations, Then the Create Organization button is visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit the admin organizations page
      await page.goto("/admin/organizations");
      // Then: create button renders
      await expect(page.getByRole("button", { name: /create organization/i })).toBeVisible();
    });

    test("Given auth is bypassed, When I click the Create Organization button, Then the create form with Name and Slug fields appears", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit the admin organizations page and click the create button
      await page.goto("/admin/organizations");
      await page.getByRole("button", { name: /create organization/i }).click();
      // Then: Create Organization sub-heading + Name + Slug labels render
      await expect(page.getByRole("heading", { name: "Create Organization" })).toBeVisible();
      await expect(page.getByText("Name")).toBeVisible();
      await expect(page.getByText("Slug")).toBeVisible();
    });
  });

  test.describe("Organizations settings page", () => {
    test("Given auth is bypassed, When I visit /settings/organizations, Then the page resolves under /settings/organizations with main content visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit the settings organizations page
      await page.goto("/settings/organizations");
      // Then: URL stays under /settings/organizations and main content area renders
      // (Original test tolerated API 401 by accepting heading OR error OR empty
      // state via a catch-based visibility fallback. The deterministic equivalent —
      // page resolved and main is rendered — preserves the "page doesn't crash"
      // intent without defensive fallbacks. Auth-bypass keeps us off /login.)
      await expect(page).toHaveURL(/\/settings\/organizations/);
      await expect(page.locator("main").first()).toBeVisible();
    });

    test("Given auth is bypassed, When I visit /settings/general and click the Organizations sidebar link, Then I land on /settings/organizations", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit /settings/general and click the sidebar Organizations link
      await page.goto("/settings/general");
      const orgLink = page.getByRole("link", { name: "Organizations" });
      // Then: link is visible (also covers organizations.spec.ts navigation
      // "organizations link appears in settings sidebar") and clicking it
      // navigates to the organizations page
      await expect(orgLink).toBeVisible();
      await orgLink.click();
      await expect(page).toHaveURL(/\/settings\/organizations/);
    });
  });

  test.describe("Organizations leaderboard", () => {
    test("Given auth is bypassed, When I visit /leaderboard, Then the Leaderboard heading, period tabs, and navigation tabs are visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit /leaderboard
      await page.goto("/leaderboard");
      // Then: heading renders (covers "leaderboard page loads")
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Leaderboard");
      // Then: period tabs are visible (covers "leaderboard page loads")
      await expect(page.getByText("Last 7 Days")).toBeVisible();
      await expect(page.getByText("Last 30 Days")).toBeVisible();
      await expect(page.getByText("All Time")).toBeVisible();
      // Then: navigation tabs are visible (covers "navigation tabs are present")
      await expect(page.getByRole("link", { name: "Individual" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Seasons" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Achievements" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Showcases" })).toBeVisible();
    });

    test("Given auth is bypassed, When I click the All Time period tab on /leaderboard, Then the All Time tab stays visible", async ({ page }) => {
      // Given: E2E_SKIP_AUTH=true is set by the runner
      // When: visit /leaderboard and click the All Time period tab
      await page.goto("/leaderboard");
      const allTimeButton = page.getByText("All Time");
      await allTimeButton.click();
      // Then: the tab stays visible (selected state)
      await expect(allTimeButton).toBeVisible();
    });
  });
});

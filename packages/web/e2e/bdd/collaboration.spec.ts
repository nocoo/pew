import { test, expect, watchPageReadiness } from "./fixtures";

test("organization creation reveals its fields; settings navigation loads membership", async ({
  page,
}) => {
  const health = watchPageReadiness(page);
  await page.goto("/admin/organizations");
  await health.ready(["/api/admin/organizations"]);
  await page.getByRole("button", { name: "Create Organization" }).click();
  await expect(page.getByRole("heading", { name: "Create Organization" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeEditable();
  await expect(page.getByRole("textbox", { name: "Slug", exact: true })).toBeEditable();
  await page.goto("/settings/general");
  await health.ready(["/api/settings"]);
  await page.locator("aside nav").getByRole("button", { name: "Organizations" }).first().click();
  await health.ready(["/api/organizations", "/api/organizations/mine"]);
  await expect(page.getByText("Readiness Organization", { exact: true })).toBeVisible();
});

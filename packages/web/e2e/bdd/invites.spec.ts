import { test, expect } from "./fixtures";

const INVITE = {
  id: 1,
  code: "PEW-A1B2",
  created_by: "admin",
  created_at: "2026-09-01T00:00:00Z",
  used_by: null,
  used_at: null,
};

test.describe("Invite code controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: null }));
    await page.route("**/api/admin/check", (route) =>
      route.fulfill({ json: { isAdmin: true } }),
    );
    await page.route("**/api/admin/invites", (route) =>
      route.fulfill({ json: { rows: [INVITE] } }),
    );
  });

  test("registration switch saves both directions and visibly changes state", async ({ page }) => {
    let savedValue = "true";
    const writes: unknown[] = [];
    await page.route("**/api/admin/settings", async (route) => {
      if (route.request().method() === "PUT") {
        await expect(page.getByRole("switch", { name: "Require invite code for registration" })).toBeDisabled();
        const body = route.request().postDataJSON();
        writes.push(body);
        savedValue = body.value;
        return route.fulfill({ json: body });
      }
      return route.fulfill({
        json: { settings: [{ key: "require_invite_code", value: savedValue }] },
      });
    });

    await page.goto("/admin/invites");
    const toggle = page.getByRole("switch", { name: "Require invite code for registration" });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    const thumb = toggle.locator("span");
    const checkedX = (await thumb.boundingBox())!.x;
    const checkedColor = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);

    await page.getByText("Require invite code for registration", { exact: true }).click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => (await thumb.boundingBox())!.x).toBeLessThan(checkedX - 10);
    await expect.poll(() => toggle.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(checkedColor);
    await expect(page.getByText("Anyone can register without an invite code.")).toBeVisible();
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();

    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await expect(page.getByText("New users must enter a valid invite code to register.")).toBeVisible();
    await page.reload();
    await expect(toggle).toBeChecked();
    expect(writes).toEqual([
      { key: "require_invite_code", value: "false" },
      { key: "require_invite_code", value: "true" },
    ]);
  });

  test("a failed registration setting save keeps the saved state and allows retry", async ({ page }) => {
    let rejectSave = true;
    await page.route("**/api/admin/settings", (route) => {
      if (route.request().method() === "PUT") {
        return rejectSave
          ? route.fulfill({ status: 500, json: { error: "Setting could not be saved" } })
          : route.fulfill({ json: route.request().postDataJSON() });
      }
      return route.fulfill({
        json: { settings: [{ key: "require_invite_code", value: rejectSave ? "true" : "false" }] },
      });
    });

    await page.goto("/admin/invites");
    const toggle = page.getByRole("switch", { name: "Require invite code for registration" });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(page.getByText("Setting could not be saved")).toBeVisible();
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();

    rejectSave = false;
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();
  });

  test("each code is shown once and can be copied individually or in bulk", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/admin/settings", (route) => route.fulfill({ json: { settings: [] } }));
    await page.goto("/admin/invites");
    const codeCell = page.getByRole("row").filter({ hasText: INVITE.code }).getByRole("cell").first();
    await expect(codeCell).toHaveText(INVITE.code);
    await codeCell.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(INVITE.code);
    await page.getByRole("button", { name: "Copy available", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`- ${INVITE.code}`);
  });

  test("bulk copy reports clipboard failure and can be retried", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
      let fail = true;
      navigator.clipboard.writeText = async (text) => {
        if (fail) {
          fail = false;
          throw new Error("Clipboard unavailable");
        }
        await writeText(text);
      };
    });
    await page.route("**/api/admin/settings", (route) => route.fulfill({ json: { settings: [] } }));
    await page.goto("/admin/invites");
    const copy = page.getByRole("button", { name: "Copy available", exact: true });
    const copyError = page.getByRole("alert").filter({ hasText: "Could not copy. Try again." });
    await copy.click();
    await expect(copyError).toBeVisible();
    await copy.click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect(copyError).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`- ${INVITE.code}`);
  });
});

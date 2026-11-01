import { test, expect, mockDashboardApis, DASHBOARD_USAGE_FIXTURE, DASHBOARD_PRICING_FIXTURE } from "./fixtures";

interface DeviceFixture {
  device_id: string;
  alias: string | null;
  first_seen: string;
  last_seen: string;
  total_tokens: number;
  sources: string[];
  model_count: number;
  revoked: boolean;
}

function mockDeviceApis(page: Parameters<typeof mockDashboardApis>[0]) {
  let devices: DeviceFixture[] = [
    {
      device_id: "work",
      alias: "Work Mac",
      first_seen: "2026-09-01T08:00:00Z",
      last_seen: "2026-09-15T12:00:00Z",
      total_tokens: 900_000,
      sources: ["claude-code", "codex"],
      model_count: 2,
      revoked: false,
    },
    {
      device_id: "home",
      alias: "Home Mac",
      first_seen: "2026-09-02T08:00:00Z",
      last_seen: "2026-09-14T12:00:00Z",
      total_tokens: 900_000,
      sources: ["opencode"],
      model_count: 1,
      revoked: true,
    },
  ];

  return {
    async register() {
      await page.route("**/api/devices", async (route) => {
        const request = route.request();
        if (request.method() === "GET") {
          return route.fulfill({ json: { devices } });
        }
        if (request.method() === "PATCH") {
          const body = request.postDataJSON() as { device_id: string; revoked: boolean };
          devices = devices.map((device) => device.device_id === body.device_id
            ? { ...device, revoked: body.revoked }
            : device);
          return route.fulfill({ json: { success: true } });
        }
        if (request.method() === "DELETE") {
          const body = request.postDataJSON() as { device_id: string };
          devices = devices.filter((device) => device.device_id !== body.device_id);
          return route.fulfill({ json: { success: true } });
        }
        return route.abort();
      });

      await page.route("**/api/usage?*", (route) => {
        const requestUrl = new URL(route.request().url());
        const deviceId = requestUrl.searchParams.get("deviceId");
        const records = DASHBOARD_USAGE_FIXTURE.records.map((row, index) => ({
          ...row,
          device_id: deviceId ?? "work",
          source: index === 0 ? "claude-code" : "codex",
          model: index === 0 ? "claude-opus-4.6" : "gpt-5.4",
          hour_start: index === 0 ? "2026-09-15T20:15:00+08:00" : index === 1 ? "2026-09-14T12:30:00.000Z" : "2026-09-13T12:00:00Z",
        }));
        return route.fulfill({ json: { records, summary: DASHBOARD_USAGE_FIXTURE.summary } });
      });
    },
  };
}

test.describe("Manage devices", () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page, { usage: DASHBOARD_USAGE_FIXTURE, pricing: DASHBOARD_PRICING_FIXTURE });
  });

  test("shows status and restores revoked historical usage", async ({ page }) => {
    const devices = mockDeviceApis(page);
    await devices.register();

    await page.goto("/manage-devices");

    await expect(page.getByText("Home Mac", { exact: true })).toBeVisible();
    await expect(page.getByText("Work Mac", { exact: true })).toBeVisible();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(page.getByText("900.0K tokens", { exact: true })).toHaveCount(2);

    await page.getByRole("button", { name: "Restore Home Mac", exact: true }).click();
    await expect(page.getByRole("button", { name: "Revoke Home Mac", exact: true })).toBeVisible();
    await expect(page.getByText("Revoked", { exact: true })).toHaveCount(0);
  });

  test("revoke uses confirmation and exposes recent activity", async ({ page }) => {
    const devices = mockDeviceApis(page);
    await devices.register();

    await page.goto("/manage-devices");

    const detailButton = page.getByRole("button", { name: "View details for Work Mac", exact: true });
    await detailButton.hover();
    await expect(page.getByRole("tooltip", { name: "View details" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    const usageRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/api/usage" &&
      new URL(request.url()).searchParams.get("deviceId") === "work");
    await detailButton.click();

    const request = await usageRequest;
    expect(new URL(request.url()).searchParams.get("granularity")).toBe("half-hour");

    const detailDialog = page.getByRole("dialog", { name: "Work Mac", exact: true });
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText("Recent activity", { exact: true })).toBeVisible();
    await expect(detailDialog.getByText("Claude Code", { exact: true })).toBeVisible();
    await expect(detailDialog.getByText("claude-opus-4.6", { exact: true })).toBeVisible();
    await expect(detailDialog.getByText("600.0K", { exact: true }).first()).toBeVisible();

    const sourceBadge = detailDialog.getByText("Claude Code", { exact: true });
    await expect(sourceBadge).toHaveCSS("color", "rgb(255, 255, 255)");

    await page.getByRole("button", { name: "Close details", exact: true }).click();

    const revokeButton = page.getByRole("button", { name: "Revoke Work Mac", exact: true });
    await revokeButton.hover();
    await expect(page.getByRole("tooltip", { name: "Revoke device" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await revokeButton.click();
    const revokeDialog = page.getByRole("alertdialog", { name: "Revoke Work Mac", exact: true });
    await expect(revokeDialog).toBeVisible();
    await expect(revokeDialog).toContainText("token-usage, accounting, and evidence records tagged with this device");
    await expect(revokeDialog).toContainText("Session uploads without a device ID continue to sync and count at the account level");
    await revokeDialog.getByRole("button", { name: "Revoke", exact: true }).click();

    await expect(page.getByRole("button", { name: "Restore Work Mac", exact: true })).toBeVisible();
    await expect(page.getByText("Revoked", { exact: true })).toHaveCount(2);
    await expect(page.getByText("900.0K tokens", { exact: true })).toHaveCount(2);
  });

  test("keeps revoke and delete errors visible after confirmation closes", async ({ page }) => {
    const devices = mockDeviceApis(page);
    await devices.register();
    await page.route("**/api/devices", async (route) => {
      const method = route.request().method();
      if (method === "PATCH") return route.fulfill({ status: 503, json: { error: "Device revoke failed" } });
      if (method === "DELETE") return route.fulfill({ status: 503, json: { error: "Device delete failed" } });
      return route.fallback();
    });

    await page.goto("/manage-devices");
    await page.getByRole("button", { name: "Revoke Work Mac", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Revoke Work Mac", exact: true }).getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("Device revoke failed", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);

    await page.getByRole("button", { name: "Delete Work Mac", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Delete Work Mac", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("Device delete failed", { exact: true })).toBeVisible();
    await expect(page.getByText("Work Mac", { exact: true })).toBeVisible();
  });

  test("delete is keyboard-safe and moves focus for the surviving and last devices", async ({ page }) => {
    const devices = mockDeviceApis(page);
    await devices.register();

    await page.goto("/manage-devices");

    await page.getByRole("button", { name: "Delete Work Mac", exact: true }).hover();
    await expect(page.getByRole("tooltip", { name: "Delete device" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await page.getByRole("button", { name: "Delete Work Mac", exact: true }).focus();
    await page.keyboard.press("Enter");

    const workDeleteDialog = page.getByRole("alertdialog", { name: "Delete Work Mac", exact: true });
    await expect(workDeleteDialog).toBeVisible();
    await workDeleteDialog.getByRole("button", { name: "Delete", exact: true }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("Work Mac", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Home Mac", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "View details for Home Mac", exact: true })).toBeFocused();

    await page.getByRole("button", { name: "Delete Home Mac", exact: true }).focus();
    await page.keyboard.press("Enter");

    const homeDeleteDialog = page.getByRole("alertdialog", { name: "Delete Home Mac", exact: true });
    await expect(homeDeleteDialog).toBeVisible();
    await homeDeleteDialog.getByRole("button", { name: "Delete", exact: true }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("Home Mac", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "CLI Login Code", exact: true })).toBeFocused();
  });
});

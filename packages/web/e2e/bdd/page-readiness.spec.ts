import { type Locator, type Page } from "@playwright/test";
import { test, expect, watchPageReadiness } from "./fixtures";
import { READINESS_PAGES, READINESS_REDIRECTS } from "./readiness-cases";

test.use({ timezoneId: "UTC" });

function fixtureEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}: run the isolated, seeded UI runner`);
  return value;
}

function resolveRoute(path: string, profile = false): string {
  return path
    .replace("[teamId]", fixtureEnv("E2E_READINESS_TEAM_ID"))
    .replace(
      "[slug]",
      fixtureEnv(profile ? "E2E_READINESS_PROFILE_SLUG" : "E2E_READINESS_SEASON_SLUG"),
    );
}

async function chart(container: Locator): Promise<void> {
  await expect(container).toBeVisible();
  await container.scrollIntoViewIfNeeded();
  await expect(container.locator(".recharts-surface").first()).toBeVisible();
  await expect
    .poll(
      () =>
        container
          .locator(
            ".recharts-bar-rectangle path, .recharts-area-area, .recharts-line-curve, .recharts-pie-sector path",
          )
          .evaluateAll((paths) =>
            paths.some((path) => {
              const { width, height } = (path as SVGGraphicsElement).getBBox();
              return path.classList.contains("recharts-line-curve")
                ? width > 0 || height > 0
                : width > 0 && height > 0;
            }),
          ),
      { message: "Chart must contain a nonempty data series, not just axes" },
    )
    .toBe(true);
}

async function namedChart(page: Page, name: string): Promise<void> {
  const title = page.locator("p").filter({ hasText: new RegExp(`^${name}$`) });
  await chart(
    title.locator(
      "xpath=ancestor::*[(self::div or self::figure) and .//*[local-name()='svg' and contains(@class,'recharts-surface')]][1]",
    ),
  );
}

async function stat(page: Page, title: string, value: string): Promise<void> {
  const label = page.locator("p").filter({ hasText: new RegExp(`^${title}$`) });
  await expect(label.locator("xpath=following-sibling::p[1]")).toHaveText(value);
}

async function rows(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names)
    await expect(page.locator("tbody tr").filter({ hasText: name })).toBeVisible();
}

const checks: Record<(typeof READINESS_PAGES)[number]["check"], (page: Page) => Promise<void>> = {
  landing: async (page) => {
    await expect(page.getByRole("link", { name: "Enter dashboard" })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(page.getByText("npm install -g @nocoo/pew", { exact: true })).toBeVisible();
  },
  login: async (page) => {
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "privacy policy", exact: true })).toHaveAttribute(
      "href",
      "/privacy",
    );
  },
  privacy: async (page) => {
    await expect(
      page.getByText("Token counts (input, cached input, output, reasoning output)", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("one-way SHA-256 hash", { exact: true }).first()).toBeVisible();
  },
  overview: async (page) => {
    await stat(page, "Total Tokens", "1.8M");
    await stat(page, "Cache Hit Rate", "25.0%");
    for (const name of ["Activity", "Goal Tracker"]) {
      await expect(
        page
          .getByRole("region", { name, exact: true })
          .getByRole("img", { name: /: Tokens 900\.0K$/ })
          .first(),
      ).toBeVisible();
    }
    await expect(page.getByRole("status", { name: "Monthly salary equivalent" })).toContainText(
      /\d/,
    );
    for (const name of [
      "Daily Usage",
      "Daily Cache Hit Rate",
      "By Agent",
      "Input / Output",
      "Hourly Usage",
    ])
      await namedChart(page, name);
    await chart(page.getByRole("figure", { name: "Daily token breakdown" }));
    await chart(page.getByRole("figure", { name: "Token share" }));
    await page
      .getByRole("group", { name: "Breakdown dimension" })
      .getByRole("button", { name: "Device", exact: true })
      .click();
    await expect(
      page.getByRole("figure", { name: "Token share" }).getByRole("listitem"),
    ).toHaveCount(2);
    await expect(page.getByRole("figure", { name: "Token share" })).toContainText("Readiness Work");
    await chart(page.getByRole("figure", { name: "Daily token breakdown" }));
  },
  devices: async (page) => {
    await stat(page, "Devices", "2");
    await stat(page, "Active \\(7d\\)", "2");
    await rows(page, ["Readiness Work", "Readiness Home"]);
    for (const row of ["Readiness Work", "Readiness Home"])
      await expect(page.locator("tbody tr").filter({ hasText: row })).toContainText("900.0K");
    for (const name of [
      "Device Trend",
      "Device Share",
      "Token Breakdown by Device",
      "By Agent",
      "By Model",
      "Agent Trend",
      "Model Mix",
    ])
      await namedChart(page, name);
  },
  agents: async (page) => {
    for (const name of ["Tool Usage Trend", "By Agent"]) await namedChart(page, name);
    await expect(page.getByRole("heading", { name: "Claude Code", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    for (const row of await page.locator("tbody tr").all())
      await expect(row).toContainText("900.0K");
  },
  models: async (page) => {
    await expect(page.locator("tbody tr")).toHaveCount(2);
    for (const row of await page.locator("tbody tr").all())
      await expect(row).toContainText("900.0K");
    for (const name of ["Tool Usage Trend", "Model Evolution", "By Model"])
      await namedChart(page, name);
  },
  daily: async (page) => {
    await expect(page.locator("tbody tr").first()).toContainText("900.0K");
    await expect(page.locator(".recharts-surface")).toHaveCount(7);
    for (const surface of await page.locator(".recharts-surface").all())
      await chart(surface.locator(".."));
  },
  hourly: async (page) => {
    await expect(page.locator("tbody tr").first()).toContainText("900.0K");
    await expect(page.locator(".recharts-surface")).toHaveCount(7);
    for (const surface of await page.locator(".recharts-surface").all())
      await chart(surface.locator(".."));
  },
  sessions: async (page) => {
    await stat(page, "Sessions", "4");
    await stat(page, "Total Hours", "2.0");
    await stat(page, "Avg Messages", "10");
    await namedChart(page, "Daily Activity");
    await page.locator("main").getByRole("button", { name: "By Device", exact: true }).click();
    await namedChart(page, "Daily Activity");
    await expect(page.getByText("Readiness Work", { exact: true })).toBeVisible();
    const workingHours = page.getByText("Working Hours", { exact: true }).locator("../..");
    await expect(workingHours.locator(".chart-animate")).toHaveCount(168);
    const peakHours = page.getByText("Peak Hours", { exact: true }).locator("../..");
    await expect(peakHours.locator('[style*="height: 100%"]')).not.toHaveCount(0);
  },
  manageDevices: async (page) => {
    for (const name of ["Readiness Work", "Readiness Home"])
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText("900.0K tokens", { exact: true })).toHaveCount(2);
  },
  prices: async (page) => {
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await expect(page.locator("tbody tr").first().getByRole("cell").nth(3)).toContainText(/\d/);
  },
  settings: async (page) => {
    await expect(page.getByLabel("Profile URL", { exact: true })).toHaveValue(
      fixtureEnv("E2E_READINESS_PROFILE_SLUG"),
    );
    await expect(page.getByRole("switch", { name: "Show my profile publicly" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  },
  organizations: async (page) => {
    await expect(page.getByText("Readiness Organization", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Joined", exact: true })).toBeEnabled();
  },
  teams: async (page) => {
    await expect(page.getByText("Readiness Team", { exact: true })).toBeVisible();
    await expect(page.getByText("1 member", { exact: false })).toBeVisible();
  },
  team: async (page) => {
    await expect(page.getByRole("button").filter({ hasText: "E2E Test User" })).toBeVisible();
    await expect(page.getByText("Readiness Season", { exact: true })).toBeVisible();
    await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  },
  leaderboard: async (page) => {
    await expect(page.getByText("E2E Test User", { exact: true })).toBeVisible();
    await expect(page.getByText("Readiness Peer", { exact: true })).toBeVisible();
    await expect(page.getByText(/^(1,800,000|900,000)$/)).toHaveCount(2);
  },
  seasons: async (page) => {
    await expect(page.getByRole("link").filter({ hasText: "Readiness Season" })).toHaveAttribute(
      "href",
      `/leaderboard/seasons/${fixtureEnv("E2E_READINESS_SEASON_SLUG")}`,
    );
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
  },
  season: async (page) => {
    const team = page.getByRole("button").filter({ hasText: "Readiness Team" });
    await expect(team).toContainText("1,800,000");
    const members = page.waitForResponse(
      (response) => response.url().includes("expand=members") && response.ok(),
    );
    await team.click();
    await members;
    await expect(page.getByRole("button", { name: /E2E Test User/ })).toBeVisible();
  },
  profile: async (page) => {
    await stat(page, "Total Tokens", "1.8M");
    for (const name of ["Daily Usage", "By Agent", "By Model"]) await namedChart(page, name);
    await expect(page.getByRole("img", { name: /900\.0K$/ }).first()).toBeVisible();
  },
  invites: async (page) => {
    await rows(page, ["PEW-RDY1"]);
    await expect(
      page.getByRole("switch", { name: "Require invite code for registration" }),
    ).toBeEnabled();
  },
  adminOrganizations: async (page) => {
    await rows(page, ["Readiness Organization"]);
  },
  adminSeasons: async (page) => {
    await rows(page, ["Readiness Season"]);
  },
  storage: async (page) => {
    await rows(page, ["E2E Test User", "Readiness Peer"]);
    await expect(page.getByText("Cached Keys", { exact: true }).locator("..")).toContainText(/\d/);
  },
  compare: async (page) => {
    await rows(page, ["E2E Test User", "Readiness Peer"]);
  },
  comparison: async (page) => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const to = tomorrow.toISOString().slice(0, 10);
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/usage/compare" &&
        new URL(response.url()).searchParams.get("to") === to &&
        response.ok(),
    );
    await page.getByLabel("To", { exact: true }).fill(to);
    await refreshed;
    await rows(page, ["E2E Test User", "Readiness Peer"]);
    for (const row of await page.locator("tbody tr").all()) await expect(row).toContainText("1.8M");
    await chart(page.locator(".recharts-surface").first().locator(".."));
  },
};

test.describe("Seeded page and module readiness (real APIs)", () => {
  test("all readiness routes render cleanly", async ({ page }) => {
    test.setTimeout(180_000);
    for (const entry of READINESS_PAGES) {
      const health = watchPageReadiness(page);
      let path = resolveRoute(entry.route, entry.check === "profile");
      if (entry.check === "comparison")
        path += `?userIds=${fixtureEnv("E2E_TEST_USER_ID")},${fixtureEnv("E2E_READINESS_PEER_ID")}`;
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await health.ready([
        "/api/auth/session",
        ...entry.apis.map((api) => resolveRoute(api, entry.check === "profile")),
      ]);
      await checks[entry.check](page);
      await health.ready([]);
      health.dispose();
      await expect(
        page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)")),
      ).toHaveCount(0);
      await expect(
        page.getByText(/Failed to load|Application error|Internal Server Error/),
      ).toHaveCount(0);
    }
  });

  test("retired routes redirect exactly; settings and empty comparison load their destinations", async ({
    page,
    request,
  }) => {
    for (const entry of READINESS_REDIRECTS) {
      if (entry.status !== 200) {
        const response = await request.get(entry.from, { maxRedirects: 0 });
        expect(response.status(), entry.from).toBe(entry.status);
        expect(response.headers().location, entry.from).toBe(entry.to);
      }
    }
    const health = watchPageReadiness(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/general$/);
    await health.ready(["/api/settings"]);
    await checks.settings(page);
    await page.goto("/admin/compare/result");
    await expect(page).toHaveURL(/\/admin\/compare$/);
    await health.ready(["/api/admin/storage"]);
    await checks.compare(page);
  });

  test("missing dynamic resources are exact 404/403, never a tolerated 500", async ({ page }) => {
    for (const [path, api, status, text] of [
      ["/u/readiness-missing", "/api/users/readiness-missing", 404, "No public profile found"],
      [
        "/leaderboard/seasons/readiness-missing",
        "/api/seasons/readiness-missing/leaderboard",
        404,
        "Season not found",
      ],
      ["/teams/readiness-missing", "/api/teams/readiness-missing", 403, "Not a member"],
    ] as const) {
      const health = watchPageReadiness(page, { [api]: status });
      expect((await page.goto(path))?.status()).toBe(200);
      await health.ready([api]);
      await expect(page.getByText(text, { exact: false })).toBeVisible();
      health.dispose();
    }
    const health = watchPageReadiness(page);
    expect((await page.goto("/readiness-missing-page"))?.status()).toBe(404);
    await health.ready(["/api/auth/session"]);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });
});

test("readiness rejects main and auxiliary module 500s even when the heading renders", async ({
  page,
}) => {
  for (const [path, api, heading] of [
    ["/devices", "/api/usage/by-device", "By Device"],
    ["/sessions", "/api/usage/by-device", "Sessions"],
  ] as const) {
    await page.route(`**${api}?*`, (route) =>
      route.fulfill({ status: 500, json: { error: "Readiness mutation" } }),
    );
    const health = watchPageReadiness(page);
    const failed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === api && response.status() === 500,
    );
    expect((await page.goto(path))?.status()).toBe(200);
    await failed;
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(health.ready([api])).rejects.toThrow(`500 ${api}`);
    health.dispose();
    await page.unrouteAll({ behavior: "wait" });
  }
});

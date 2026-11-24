import { test as base, expect, type Page, type Request, type Response } from "@playwright/test";

export function watchPageReadiness(
  page: Page,
  expectedErrors: Partial<Record<string, 403 | 404>> = {},
) {
  const errors: string[] = [];
  const completed = new Set<string>();
  const pending = new Set<Request>();
  const bodies = new Set<Promise<void>>();
  const isApi = (request: Request) => new URL(request.url()).pathname.startsWith("/api/");
  const onRequest = (request: Request) => {
    if (isApi(request)) pending.add(request);
  };
  const onFinished = (request: Request) => {
    pending.delete(request);
  };
  const onFailed = (request: Request) => {
    pending.delete(request);
    if (isApi(request) && request.failure()?.errorText !== "net::ERR_ABORTED")
      errors.push(`${request.failure()?.errorText} ${request.url()}`);
  };
  const onPageError = (error: Error) => {
    errors.push(error.message);
  };
  const onResponse = (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (!isApi(response.request())) {
      if (response.status() >= 500) errors.push(`${response.status()} ${path}`);
      return;
    }
    const expected = expectedErrors[path] ?? 200;
    if (response.status() !== expected)
      errors.push(`${response.status()} ${path} (expected ${expected})`);
    const body = (async () => {
      try {
        const json = await response.json();
        if (expected === 200 && json?.error) errors.push(`${path}: ${JSON.stringify(json.error)}`);
        if (response.status() === expected) completed.add(response.url());
      } catch (error) {
        if (response.request().failure()?.errorText !== "net::ERR_ABORTED")
          errors.push(`${path}: ${String(error)}`);
      }
    })();
    bodies.add(body);
    void body.finally(() => bodies.delete(body));
  };
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  page.on("response", onResponse);
  page.on("pageerror", onPageError);
  return {
    async ready(required: readonly string[]) {
      if (errors.length) throw new Error(errors.join("\n"));
      await expect
        .poll(
          () => ({
            errors,
            pending: pending.size + bodies.size,
            missing: required.filter((api) => {
              const target = new URL(api, "http://readiness.invalid");
              const count = Number(target.hash.slice(1) || 1);
              return (
                [...completed].filter((url) => {
                  const actual = new URL(url);
                  return (
                    actual.pathname === target.pathname &&
                    [...target.searchParams].every(([key, value]) =>
                      value ? actual.searchParams.get(key) === value : actual.searchParams.has(key),
                    )
                  );
                }).length < count
              );
            }),
          }),
          { message: "All required API requests must complete without page/module errors" },
        )
        .toEqual({ errors: [], pending: 0, missing: [] });
    },
    dispose() {
      page.off("request", onRequest);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      page.off("response", onResponse);
      page.off("pageerror", onPageError);
    },
  };
}

export const DASHBOARD_USAGE_FIXTURE = {
  records: [
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-01T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 600_000,
    },
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-02T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 600_000,
    },
    {
      source: "claude-code",
      model: "claude-sonnet-4-20250514",
      hour_start: "2026-05-03T00:00:00.000Z",
      input_tokens: 300_000,
      cached_input_tokens: 100_000,
      output_tokens: 150_000,
      reasoning_output_tokens: 50_000,
      total_tokens: 600_000,
    },
  ],
  summary: {
    total_tokens: 1_800_000,
    input_tokens: 900_000,
    output_tokens: 450_000,
    cached_input_tokens: 300_000,
    reasoning_output_tokens: 150_000,
  },
} as const;

export const DASHBOARD_USAGE_EMPTY_FIXTURE = {
  records: [],
  summary: {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
  },
} as const;

export const DASHBOARD_PRICING_FIXTURE = {
  models: { "claude-sonnet-4-20250514": { input: 3, output: 15, cached: 0.3 } },
  prefixes: [],
  sourceDefaults: {},
  fallback: { input: 0, output: 0 },
} as const;

export type DashboardMockOptions = {
  usage: unknown;
  pricing: unknown;
};

export async function mockDashboardApis(page: Page, opts: DashboardMockOptions): Promise<void> {
  // Overview tests only consume synthetic data, including ancillary shell APIs.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: "overview-test",
      name: "Overview Test",
      email: "overview@local.invalid",
      image: null,
    };
    const shell: Record<string, unknown> = {
      "/api/auth/session": { user, expires: "2099-01-01T00:00:00Z" },
      "/api/admin/check": { isAdmin: false },
      "/api/settings": {
        ...user,
        slug: "overview-test",
        is_public: 1,
        cli_upgrade_notice_seen_at: "2026-01-01T00:00:00Z",
      },
      "/api/cli-upgrade-notice": { show: false },
      "/api/organizations/mine": { organizations: [] },
      "/api/teams": { teams: [] },
      "/api/pricing/models": { entries: [], meta: null, servedFrom: "baseline" },
    };
    if (Object.hasOwn(shell, path)) return route.fulfill({ json: shell[path] });
    await route.abort();
    throw new Error(`Unexpected dashboard mock request: ${route.request().method()} ${path}`);
  });
  await page.route("**/api/usage?*", (route) => {
    const usage = opts.usage as {
      records: Array<Record<string, unknown>>;
      summary: Record<string, number>;
    };
    const params = new URL(route.request().url()).searchParams;
    const from = params.has("from") ? new Date(params.get("from")!).getTime() : -Infinity;
    const to = params.has("to") ? new Date(params.get("to")!).getTime() : Infinity;
    const records = usage.records.filter((row) => {
      const time = new Date(row.hour_start as string).getTime();
      return time >= from && time < to;
    });
    const summary = Object.fromEntries(
      Object.keys(usage.summary).map((key) => [
        key,
        records.reduce((total, row) => total + Number(row[key] ?? 0), 0),
      ]),
    );
    return route.fulfill({ json: { records, summary } });
  });
  await page.route("**/api/usage/by-device?*", (route) => {
    const { records } = opts.usage as { records: Array<Record<string, unknown>> };
    const params = new URL(route.request().url()).searchParams;
    const from = new Date(params.get("from")!).getTime();
    const to = new Date(params.get("to")!).getTime();
    const details: Array<Record<string, unknown> & { device_id: string }> = records
      .filter((row) => {
        const time = new Date(row.hour_start as string).getTime();
        return time >= from && time < to;
      })
      .map((row, i) => ({ ...row, device_id: i < 2 ? "work" : "home" }));
    const tzOffset = Number(params.get("tzOffset") ?? 0);
    const timeline = details.map((row) => ({
      ...row,
      date: new Date(new Date(row.hour_start as string).getTime() - tzOffset * 60_000)
        .toISOString()
        .slice(0, 10),
    }));
    return route.fulfill({
      json: {
        deviceDetails: details,
        timeline,
        devices: ["work", "home"].map((id) => ({
          device_id: id,
          alias: id === "work" ? "Work Mac" : "Home Mac",
          sources: [],
          models: [],
          first_seen: "2026-05-01",
          last_seen: "2026-05-03",
          estimated_cost: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
        })),
      },
    });
  });
  await page.route("**/api/pricing", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opts.pricing),
    }),
  );
}

export { base as test, expect };

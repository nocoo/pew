import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { READINESS_PAGES, READINESS_REDIRECTS } from "../../packages/web/e2e/bdd/readiness-cases";
import { seedReadiness } from "../readiness-seed";

it("maps every page to populated readiness or an explicit redirect", () => {
  const pages = readdirSync("packages/web/src/app", { recursive: true })
    .filter((file) => file === "page.tsx" || String(file).endsWith("/page.tsx"))
    .map(
      (file) =>
        `/${String(file)
          .replace(/(?:^|\/)\([^/]+\)/g, "")
          .replace(/\/?page\.tsx$/, "")
          .replace(/^\//, "")}`,
    )
    .sort();
  const covered = [
    ...READINESS_PAGES.map((entry) => entry.route),
    ...READINESS_REDIRECTS.filter((entry) => entry.page).map((entry) => entry.from),
  ];
  expect(covered.sort()).toEqual(pages);
  for (const entry of READINESS_PAGES) {
    expect(entry.check, entry.route).toBeTruthy();
  }
});

it("seeds current usage, devices and populated collaboration without foreign-key gaps", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const superseded = new Set([
      "004-is-public.sql",
      "006-device-id.sql",
      "006c-team-logo-url.sql",
    ]);
    for (const name of readdirSync("scripts/migrations")
      .filter((name) => name.endsWith(".sql") && !superseded.has(name))
      .sort()) {
      sqlite.exec(readFileSync(`scripts/migrations/${name}`, "utf8"));
    }
    sqlite.exec(
      "PRAGMA foreign_keys = ON; INSERT INTO users(id,email,name) VALUES ('owner','owner@test.invalid','E2E Test User')",
    );
    const prepare = (sql: string, params: unknown[] = []) => ({
      bind: (...values: unknown[]) => prepare(sql, values),
      run: async () => sqlite.prepare(sql).run(...(params as never[])),
    });
    const env = await seedReadiness(
      { prepare, batch: async (statements) => Promise.all(statements.map((s) => s.run())) },
      "owner",
    );
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(DISTINCT device_id) AS devices, COUNT(DISTINCT model) AS models, SUM(total_tokens) AS total FROM usage_records WHERE user_id='owner'",
        )
        .get(),
    ).toEqual({ devices: 2, models: 2, total: 1_800_000 });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM season_team_members WHERE team_id=?")
        .get(env.E2E_READINESS_TEAM_ID!),
    ).toEqual({ n: 1 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM seasons WHERE datetime(start_date) < datetime('now') AND datetime(end_date) > datetime('now')",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE is_public=1").get()).toEqual({
      n: 2,
    });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM usage_records WHERE datetime(hour_start) >= datetime('now','-72 hours')",
        )
        .get(),
    ).toEqual({ n: 8 });
  } finally {
    sqlite.close();
  }
});

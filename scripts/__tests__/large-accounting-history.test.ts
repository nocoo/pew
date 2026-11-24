import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { D1Database } from "../../packages/worker/node_modules/@cloudflare/workers-types";
import { seedAccountingHistory, HISTORY_ROWS } from "../accounting-history-fixture";
import { handleUsageRpc } from "../../packages/worker-read/src/rpc/usage";
import { ACCOUNTED_USAGE_SQL } from "../../packages/worker-read/src/rpc/accounting";
import { displayCounters, estimateUsageCost } from "../../packages/web/src/lib/accounting";
import { buildPricingMap } from "../../packages/web/src/lib/pricing";

describe("accounting history beyond a D1 result row", () => {
  it("preserves full device data and cost without a >2 MiB SQL value", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      for (const migration of [
        "001-init",
        "009-device-aliases",
        "022-usage-evidence",
        "026-usage-accounting",
      ]) {
        sqlite.exec(readFileSync(`scripts/migrations/${migration}.sql`, "utf8"));
      }
      sqlite.exec("INSERT INTO users(id,email) VALUES ('history','history@test.invalid')");
      const queries: string[] = [];
      const prepare = (sql: string, params: SQLInputValue[] = []) => ({
        bind: (...values: SQLInputValue[]) => prepare(sql, values),
        run: async () => sqlite.prepare(sql).run(...params),
        all: async () => {
          queries.push(sql);
          const results = sqlite.prepare(sql).all(...params);
          for (const row of results)
            for (const value of Object.values(row)) {
              if (typeof value === "string" && Buffer.byteLength(value) > 2 * 1024 * 1024)
                throw new Error("SQLITE_TOOBIG");
            }
          return { results, success: true };
        },
      });
      const db = {
        prepare,
        batch: async (statements: ReturnType<typeof prepare>[]) =>
          Promise.all(statements.map((s) => s.run())),
      } as unknown as D1Database;
      await seedAccountingHistory(db, "history");
      const size = sqlite
        .prepare("SELECT SUM(length(groups_json)) AS bytes FROM usage_details")
        .get() as { bytes: number };
      expect(size.bytes).toBeGreaterThan(2 * 1024 * 1024);
      const daily = sqlite
        .prepare(`SELECT length(json_group_array(json(accounting_json))) AS bytes
        FROM (${ACCOUNTED_USAGE_SQL}) GROUP BY date(hour_start), source, model ORDER BY bytes DESC LIMIT 1`)
        .get("history", "2020-01-01", "2026-10-01") as { bytes: number };
      expect(daily.bytes).toBeGreaterThan(2 * 1024 * 1024);
      const pricing = buildPricingMap({
        dynamic: [
          {
            model: "openai/gpt-6-astra",
            provider: "OpenAI",
            displayName: null,
            route: "direct",
            contextWindow: null,
            origin: "models.dev",
            updatedAt: "2026-10-01",
            inputPerMillion: 10,
            outputPerMillion: 50,
            cachedPerMillion: 1,
            cacheWritePerMillion: 12.5,
          },
        ],
      });
      for (const method of [
        "usage.get",
        "usage.getDeviceSummary",
        "usage.getDeviceCostDetails",
        "usage.getDeviceTimeline",
      ] as const) {
        const response = await handleUsageRpc(
          {
            method,
            userId: "history",
            fromDate: "2020-01-01",
            toDate: "2026-10-01",
            tzOffset: -480,
            granularity: "day",
          },
          db,
        );
        expect(response.status).toBe(200);
        const { result } = await response.json();
        const history = result.filter((r: { device_id?: string; source?: string }) =>
          method === "usage.get" ? r.source === "codex" : r.device_id === "history-device",
        );
        expect(
          history.reduce(
            (n: number, r: Parameters<typeof displayCounters>[0]) =>
              n + displayCounters(r).total_tokens,
            0,
          ),
        ).toBe(HISTORY_ROWS * 940);
        if (method === "usage.getDeviceCostDetails") {
          expect(estimateUsageCost(history[0], pricing).totalCost).toBeCloseTo(
            HISTORY_ROWS * 0.004025,
          );
          expect(history[0].accounting).toHaveLength(1);
        }
        expect(
          result.some((r: { device_id?: string; source?: string }) =>
            method === "usage.get" ? r.source === "pi" : r.device_id === "empty-details",
          ),
        ).toBe(true);
      }
      expect(queries.every((sql) => !sql.includes("json_group_array"))).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});

import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LeaderboardSnapshot } from "../packages/core/src/leaderboard-types";
import type { D1Database } from "../packages/worker/node_modules/@cloudflare/workers-types";
import { localIsolatedEnv, verifyLocalMarker } from "./local-e2e-bindings";
import { seedAccountingHistory, HISTORY_ROWS } from "./accounting-history-fixture";

async function verifyCorruptedCleanup(): Promise<void> {
  const corrupted = await localIsolatedEnv();
  const mutation = await fetch(`${corrupted.env.PEW_LOCAL_D1_URL}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${corrupted.env.CF_D1_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: "UPDATE _test_marker SET value='another-run' WHERE key='run'" }),
  });
  assert.equal(mutation.status, 200);
  await assert.rejects(corrupted.dispose(), /cleanup failed/);
  assert.equal(existsSync(corrupted.state), true);
  await assert.rejects(fetch(`${corrupted.env.PEW_LOCAL_D1_URL}/api/live`));
  const { getPlatformProxy } = await import("../packages/worker/node_modules/wrangler");
  const repair = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(corrupted.state, "wrangler.json"),
    envFiles: [],
    persist: { path: join(corrupted.state, "v3") },
    remoteBindings: false,
  });
  try {
    await repair.env.DB.prepare("UPDATE _test_marker SET value=? WHERE key='run'")
      .bind(corrupted.env.PEW_TEST_RUN_ID)
      .run();
    const marker = await repair.env.DB.prepare(
      "SELECT value FROM _test_marker WHERE key='run'",
    ).first<{ value: string }>();
    assert.equal(marker?.value, corrupted.env.PEW_TEST_RUN_ID);
  } finally {
    await repair.dispose();
  }
  rmSync(corrupted.state, { recursive: true });
}

if (process.argv.includes("--corrupted-only")) {
  await verifyCorruptedCleanup();
  process.exit(0);
}

// Run corrupted-marker verification concurrently in a child process (localIsolatedEnv mutates process.env).
const corruptedChild = Bun.spawn(
  [process.execPath, "--no-env-file", import.meta.filename, "--corrupted-only"],
  { stdout: "pipe", stderr: "pipe", env: process.env },
);

const local = await localIsolatedEnv();
const query = async (sql: string, params: unknown[] = []) => {
  const response = await fetch(`${local.env.PEW_LOCAL_D1_URL}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${local.env.CF_D1_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { result: Array<{ results: Array<Record<string, unknown>> }> };
};
try {
  await verifyLocalMarker(local.env);
  assert.equal(local.env.RAILWAY_ENVIRONMENT, undefined);
  assert.equal(local.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(local.env.CI, "true");
  assert.equal(local.env.PEW_SYNTHETIC_PARENT_SECRET, undefined);
  const unauthorized = await fetch(`${local.env.PEW_LOCAL_D1_URL}/query`, {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1" }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(((await unauthorized.json()) as { success: boolean }).success, false);
  const superseded = new Set(["004-is-public.sql", "006-device-id.sql", "006c-team-logo-url.sql"]);
  const migrations = readdirSync(resolve("scripts/migrations"))
    .filter((name) => name.endsWith(".sql") && !superseded.has(name))
    .sort();
  const applied = await query("SELECT name FROM d1_migrations ORDER BY id");
  assert.deepEqual(
    applied.result[0]?.results.map((row) => row.name),
    migrations.map((name, index) => `${String(index).padStart(4, "0")}-${name}`),
  );
  for (const [table, column] of [
    ["users", "is_public"],
    ["usage_records", "device_id"],
    ["teams", "logo_url"],
    ["seasons", "snapshot_ready"],
  ]) {
    const result = await query(`PRAGMA table_info(${table})`);
    assert.ok(result.result[0]?.results.some((row) => row.name === column));
  }
  await query("SELECT * FROM usage_details LIMIT 1");
  await query("SELECT * FROM usage_evidence LIMIT 1");
  await query("INSERT INTO users(id,email) VALUES (?,?)", ["fixture-user", "fixture@test.invalid"]);
  for (const device of ["device-a", "device-b"]) {
    await query(
      "INSERT INTO usage_records(user_id,device_id,source,model,hour_start) VALUES (?,?,?,?,?)",
      ["fixture-user", device, "fixture", "fixture", "2000-01-01T00:00:00Z"],
    );
  }
  const indexes = await query("PRAGMA index_list(usage_records)");
  const unique = indexes.result[0]?.results.find((row) => row.unique === 1);
  assert.ok(unique && typeof unique.name === "string");
  const columns = await query(`PRAGMA index_info(${unique.name})`);
  assert.deepEqual(
    columns.result[0]?.results.map((row) => row.name),
    ["user_id", "device_id", "source", "model", "hour_start"],
  );
  const rpc = await fetch(`${local.env.WORKER_READ_URL}/api/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${local.env.WORKER_READ_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method: "users.getById", id: "fixture-user" }),
  });
  assert.equal(rpc.status, 200);
  assert.ok(JSON.stringify(await rpc.json()).includes("fixture@test.invalid"));
  await query("UPDATE users SET is_public=1 WHERE id=?", ["fixture-user"]);
  await query(
    "UPDATE usage_records SET input_tokens=10,output_tokens=5,total_tokens=15 WHERE user_id=?",
    ["fixture-user"],
  );
  const readSnapshot = async () => {
    const response = await fetch(`${local.env.WORKER_READ_URL}/api/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${local.env.WORKER_READ_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method: "leaderboard.getSnapshot", source: "fixture" }),
    });
    const body = (await response.json()) as { result: LeaderboardSnapshot };
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.result;
  };
  const cold = await readSnapshot();
  assert.equal(cold.rows.length, 1);
  assert.equal(cold.rows[0]?.user_id, "fixture-user");
  assert.equal(cold.rows[0]?.total_tokens, 30);
  assert.ok(cold.id);
  await query("UPDATE usage_records SET input_tokens=20,total_tokens=25 WHERE user_id=?", [
    "fixture-user",
  ]);
  const warm = await readSnapshot();
  assert.equal(warm.id, cold.id);
  assert.deepEqual(warm, cold);
  const testDb = {
    prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ sql, params }) }),
    batch: async (batch: unknown[]) => {
      const response = await fetch(`${local.env.PEW_LOCAL_D1_URL}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${local.env.CF_D1_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batch }),
      });
      const body = (await response.json()) as { success: boolean };
      assert.equal(body.success, true, JSON.stringify(body));
    },
  } as unknown as D1Database;
  await seedAccountingHistory(testDb, "fixture-user");
  for (const method of [
    "usage.get",
    "usage.getDeviceSummary",
    "usage.getDeviceCostDetails",
    "usage.getDeviceTimeline",
  ]) {
    const response = await fetch(`${local.env.WORKER_READ_URL}/api/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${local.env.WORKER_READ_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method,
        userId: "fixture-user",
        fromDate: "2020-01-01",
        toDate: "2026-01-01",
        tzOffset: -480,
        granularity: "day",
      }),
    });
    const body = (await response.json()) as {
      result: Array<{
        total_tokens?: number;
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
        reasoning_output_tokens: number;
      }>;
    };
    assert.equal(response.status, 200, `${method}: ${JSON.stringify(body)}`);
    const tokens = body.result.reduce(
      (n, row) =>
        n +
        (row.total_tokens ??
          row.input_tokens +
            row.cached_input_tokens +
            row.output_tokens +
            row.reasoning_output_tokens),
      0,
    );
    assert.equal(tokens, HISTORY_ROWS * 940 + 11, method);
  }
  const retired = ["gemini-cli", "kosmos", "omp", "pmstudio", "vscode-copilot", "zcode"];
  for (const source of retired) {
    await query(
      "INSERT INTO usage_records(user_id,device_id,source,model,hour_start,input_tokens,total_tokens) VALUES (?,?,?,?,?,123,123)",
      ["fixture-user", "historical-device", source, "historical-model", "2024-01-01T00:00:00.000Z"],
    );
    const ignored = await fetch(`${local.env.WORKER_INGEST_URL}/tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${local.env.WORKER_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "fixture-user",
        records: [{ source, input_tokens: -1, private_body: "IGNORE" }],
      }),
    });
    assert.equal(ignored.status, 200);
    assert.deepEqual(await ignored.json(), { ingested: 0, ignored: 1 });
  }
  const historicalRanking = await fetch(`${local.env.WORKER_READ_URL}/api/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${local.env.WORKER_READ_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method: "leaderboard.getSnapshot", model: "historical-model" }),
  });
  const historicalBody = (await historicalRanking.json()) as { result: LeaderboardSnapshot };
  assert.equal(historicalRanking.status, 200);
  assert.equal(historicalBody.result.rows[0]?.total_tokens, 123 * retired.length);
  await query("UPDATE _test_marker SET value='production' WHERE key='env'");
  await assert.rejects(verifyLocalMarker(local.env), /_test_marker/);
  await query("UPDATE _test_marker SET value='test' WHERE key='env'");
  throw new Error("synthetic test failure");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "synthetic test failure") throw error;
} finally {
  await local.dispose();
}
assert.equal(existsSync(local.state), false);
await assert.rejects(fetch(`${local.env.PEW_LOCAL_D1_URL}/api/live`));
await local.dispose();
const [corruptedExit, corruptedOut, corruptedErr] = await Promise.all([
  corruptedChild.exited,
  new Response(corruptedChild.stdout).text(),
  new Response(corruptedChild.stderr).text(),
]);
assert.equal(corruptedExit, 0, `${corruptedOut}\n${corruptedErr}`);
console.log("Real D1 schema, marker, Worker RPC and failure cleanup verified");

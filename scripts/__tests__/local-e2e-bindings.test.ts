import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { localIsolatedEnv, splitStatements, verifyLocalMarker } from "../local-e2e-bindings";

afterEach(() => vi.unstubAllGlobals());

describe("local D1 marker", () => {
  const env = {
    NODE_ENV: "development", RESOURCE_ENV: "test", E2E_SKIP_AUTH: "true",
    CF_ACCOUNT_ID: "pew-local-test", CF_D1_DATABASE_ID: "pew-local-test", CF_D1_API_TOKEN: "synthetic",
    PEW_LOCAL_D1_URL: "http://127.0.0.1:12345", WORKER_INGEST_URL: "http://127.0.0.1:12345/ingest",
    WORKER_READ_URL: "http://127.0.0.1:12345", PEW_TEST_RUN_ID: "owned-run",
  };
  it.each([{ rows: [] }, { rows: [{ key: "env", value: "production" }, { key: "run", value: "owned-run" }] }, { rows: [{ key: "env", value: "test" }, { key: "run", value: "other-run" }] }])("rejects missing or wrong SQL marker %j", async ({ rows }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, result: [{ results: rows }] })));
    await expect(verifyLocalMarker(env)).rejects.toThrow("_test_marker");
  });
  it("queries the actual DB marker rather than /api/live", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, result: [{ results: [{ key: "env", value: "test" }, { key: "run", value: "owned-run" }] }] }));
    vi.stubGlobal("fetch", fetcher);
    await verifyLocalMarker(env);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${env.PEW_LOCAL_D1_URL}/query`);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body).sql).toContain("FROM _test_marker");
    await expect(verifyLocalMarker({ ...env, WORKER_READ_URL: "https://production.invalid" })).rejects.toThrow("same isolated");
    await expect(verifyLocalMarker({ ...env, PEW_TEST_RUN_ID: "" })).rejects.toThrow("configuration missing");
  });
});

describe("real D1 lifecycle", () => {
  it("reads migrations itself instead of spawning the wrangler CLI", async () => {
    // The CLI applies one migration per subprocess, each with a fresh
    // Miniflare; that measured 30-50s for the full set on a loaded host. A
    // missing directory fails before any D1 work, keeping this a unit test.
    const missing = mkdtempSync(join(tmpdir(), "pew-missing-migration-"));
    try {
      // The directory is copied into the per-run state dir, so the message
      // names the copy; the point is that the read fails before any D1 work.
      await expect(localIsolatedEnv(missing)).rejects.toThrow(/^No migrations present at .*\/migrations$/);
    } finally { rmSync(missing, { recursive: true }); }
  });

  // The splitter is what the real set depends on: triggers (whose bodies carry
  // `;`) and seed rows with quoted semicolons both appear in scripts/migrations,
  // and a naive split broke 029 before the lifecycle test below covered it.
  it.each([
    ["a quoted semicolon and a trailing comment", "CREATE TABLE a(id TEXT);\nINSERT INTO a VALUES ('x;y');-- tail\n", ["CREATE TABLE a(id TEXT)", "INSERT INTO a VALUES ('x;y')"]],
    ["a trigger body", "CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE a SET id = 1;\n  UPDATE a SET id = 2;\nEND;\nSELECT 1;", ["CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE a SET id = 1;\n  UPDATE a SET id = 2;\nEND", "SELECT 1"]],
    ["an exported transaction wrapper", "BEGIN TRANSACTION;\nSELECT 1;\nCOMMIT;", ["SELECT 1"]],
    ["a statement without a terminator", "SELECT 1", ["SELECT 1"]],
    ["comments only", "-- nothing to apply\n", []],
    ["a comment between statements", "SELECT 1; /* c */ SELECT 2; -- tail\n", ["SELECT 1", "/* c */ SELECT 2"]],
  ])("splits %s", (_label, sql, expected) => {
    expect(splitStatements(sql)).toEqual(expected);
  });

  it("preserves full fresh schema, native Worker RPC and failure cleanup", () => {
    // The deadline is a hang detector, not a budget.
    const result = spawnSync("bun", ["--no-env-file", "scripts/test-local-e2e.ts"], { encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "true", PEW_SYNTHETIC_PARENT_SECRET: "must-not-forward" } });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 310_000);
  it.each(["THIS IS NOT SQL;", "CREATE TABLE duplicate(id TEXT); CREATE TABLE duplicate(id TEXT);"])("fails invalid or duplicate SQL and cleans only fresh state: %s", (sql) => {
    const migrations = mkdtempSync(join(tmpdir(), "pew-invalid-migration-"));
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("pew-e2e-")));
    try {
      writeFileSync(join(migrations, "0001.sql"), sql);
      const result = spawnSync("bun", ["--no-env-file", "-e", 'import {localIsolatedEnv} from "./scripts/local-e2e-bindings.ts"; await localIsolatedEnv(process.argv[1]);', migrations], { encoding: "utf8", timeout: 120_000 });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("migrations failed");
      expect(new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("pew-e2e-")))).toEqual(before);
      expect(existsSync(migrations)).toBe(true);
    } finally { rmSync(migrations, { recursive: true }); }
  }, 130_000);
});

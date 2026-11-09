import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { localIsolatedEnv, verifyLocalMarker } from "../local-e2e-bindings";

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
  it("disables the migration CLI banner's network update check", async () => {
    for (const key of ["HOME", "XDG_CONFIG_HOME", "WRANGLER_SEND_METRICS"]) vi.stubEnv(key, process.env[key]);
    const spawn = vi.fn(() => ({
      stdout: new Response("").body,
      stderr: new Response("synthetic migration failure").body,
      exited: Promise.resolve(1),
    }));
    vi.stubGlobal("Bun", { spawn });
    try {
      await expect(localIsolatedEnv()).rejects.toThrow("synthetic migration failure");
      expect(spawn).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
        env: expect.objectContaining({ WRANGLER_HIDE_BANNER: "true", WRANGLER_SEND_METRICS: "false" }),
      }));
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("preserves full fresh schema, native Worker RPC and failure cleanup", () => {
    // The deadline is a hang detector: spawning wrangler, applying the whole
    // migration set and exercising the RPC round trip has been measured at
    // 2m30s on a loaded host, which the old 120s deadline killed.
    const result = spawnSync("bun", ["--no-env-file", "scripts/test-local-e2e.ts"], { encoding: "utf8", timeout: 300_000, env: { ...process.env, CI: "true", PEW_SYNTHETIC_PARENT_SECRET: "must-not-forward" } });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 310_000);
  it.each(["THIS IS NOT SQL;", "CREATE TABLE duplicate(id TEXT); CREATE TABLE duplicate(id TEXT);"])("fails invalid or duplicate SQL and cleans only fresh state: %s", (sql) => {
    const migrations = mkdtempSync(join(tmpdir(), "pew-invalid-migration-"));
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("pew-e2e-")));
    try {
      writeFileSync(join(migrations, "0001.sql"), sql);
      // A failing migration still pays wrangler's full startup: measured at
      // 31.5s for the unparseable file, which the old 30s deadline killed
      // before it could report "migrations failed".
      const result = spawnSync("bun", ["--no-env-file", "-e", 'import {localIsolatedEnv} from "./scripts/local-e2e-bindings.ts"; await localIsolatedEnv(process.argv[1]);', migrations], { encoding: "utf8", timeout: 120_000 });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("migrations failed");
      expect(new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("pew-e2e-")))).toEqual(before);
      expect(existsSync(migrations)).toBe(true);
    } finally { rmSync(migrations, { recursive: true }); }
  }, 130_000);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { localIsolatedEnv, verifyLocalMarker } from "../local-e2e-bindings";

function spawnAsync(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectPromise(
          new Error(`${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`),
        );
        return;
      }
      resolvePromise({ status: code, stdout, stderr });
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("local D1 marker", () => {
  const env = {
    NODE_ENV: "development",
    RESOURCE_ENV: "test",
    E2E_SKIP_AUTH: "true",
    CF_ACCOUNT_ID: "pew-local-test",
    CF_D1_DATABASE_ID: "pew-local-test",
    CF_D1_API_TOKEN: "synthetic",
    PEW_LOCAL_D1_URL: "http://127.0.0.1:12345",
    WORKER_INGEST_URL: "http://127.0.0.1:12345/ingest",
    WORKER_READ_URL: "http://127.0.0.1:12345",
    PEW_TEST_RUN_ID: "owned-run",
  };
  it.each([
    { rows: [] },
    {
      rows: [
        { key: "env", value: "production" },
        { key: "run", value: "owned-run" },
      ],
    },
    {
      rows: [
        { key: "env", value: "test" },
        { key: "run", value: "other-run" },
      ],
    },
  ])("rejects missing or wrong SQL marker %j", async ({ rows }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ success: true, result: [{ results: rows }] })),
    );
    await expect(verifyLocalMarker(env)).rejects.toThrow("_test_marker");
  });
  it("queries the actual DB marker rather than /api/live", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: [
          {
            results: [
              { key: "env", value: "test" },
              { key: "run", value: "owned-run" },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await verifyLocalMarker(env);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${env.PEW_LOCAL_D1_URL}/query`);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body).sql).toContain("FROM _test_marker");
    await expect(
      verifyLocalMarker({ ...env, WORKER_READ_URL: "https://production.invalid" }),
    ).rejects.toThrow("same isolated");
    await expect(verifyLocalMarker({ ...env, PEW_TEST_RUN_ID: "" })).rejects.toThrow(
      "configuration missing",
    );
  });
});

describe("real D1 lifecycle", () => {
  it("disables the migration CLI banner's network update check", async () => {
    for (const key of ["HOME", "XDG_CONFIG_HOME", "WRANGLER_SEND_METRICS"])
      vi.stubEnv(key, process.env[key]);
    const spawn = vi.fn(() => ({
      stdout: new Response("").body,
      stderr: new Response("synthetic migration failure").body,
      exited: Promise.resolve(1),
    }));
    vi.stubGlobal("Bun", { spawn });
    try {
      await expect(localIsolatedEnv()).rejects.toThrow("synthetic migration failure");
      expect(spawn).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            WRANGLER_HIDE_BANNER: "true",
            WRANGLER_SEND_METRICS: "false",
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe.concurrent("real D1 subprocess lifecycle", () => {
  it("preserves full fresh schema, native Worker RPC and failure cleanup", async () => {
    const result = await spawnAsync("bun", ["--no-env-file", "scripts/test-local-e2e.ts"], {
      timeoutMs: 120_000,
      env: { ...process.env, CI: "true", PEW_SYNTHETIC_PARENT_SECRET: "must-not-forward" },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 125_000);
  it.each([
    "THIS IS NOT SQL;",
    "CREATE TABLE duplicate(id TEXT); CREATE TABLE duplicate(id TEXT);",
  ])(
    "fails invalid or duplicate SQL and cleans only fresh state: %s",
    async (sql) => {
      const isolatedTmp = mkdtempSync(join(tmpdir(), "pew-invalid-tmp-"));
      const migrations = mkdtempSync(join(isolatedTmp, "migrations-"));
      try {
        writeFileSync(join(migrations, "0001.sql"), sql);
        const result = await spawnAsync(
          "bun",
          [
            "--no-env-file",
            "-e",
            'import {localIsolatedEnv} from "./scripts/local-e2e-bindings.ts"; await localIsolatedEnv(process.argv[1]);',
            migrations,
          ],
          { timeoutMs: 30_000, env: { ...process.env, TMPDIR: isolatedTmp } },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("migrations failed");
        expect(readdirSync(isolatedTmp).filter((name) => name.startsWith("pew-e2e-"))).toEqual([]);
        expect(existsSync(migrations)).toBe(true);
      } finally {
        rmSync(isolatedTmp, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

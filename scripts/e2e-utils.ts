import { readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyLocalMarker } from "./local-e2e-bindings";

async function deadline<Result>(promise: Promise<Result>, milliseconds: number, label: string): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// The startup deadline exists to catch a wedged child, not to enforce a speed
// budget. On a host running several other suites, a healthy start has been
// measured at 99s against the 60s default — a false failure, and the reason
// the pre-push lane gets bypassed rather than trusted. A positive integer
// override lets that host raise the budget without editing code for every
// clone; anything else falls back to the default rather than disabling the
// deadline entirely.
const DEFAULT_BINDINGS_TIMEOUT_MS = 60_000;
const BINDINGS_TIMEOUT_ENV = "PEW_E2E_BINDINGS_TIMEOUT_MS";

function configuredBindingsTimeoutMs(): number {
  const raw = process.env[BINDINGS_TIMEOUT_ENV];
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_BINDINGS_TIMEOUT_MS;
  const value = Number(raw);
  return value > 0 ? value : DEFAULT_BINDINGS_TIMEOUT_MS;
}

export async function startLocalBindings(
  signal: AbortSignal,
  timeoutMs = configuredBindingsTimeoutMs(),
  readiness = false,
) {
  signal.throwIfAborted();
  let receive: (value: { env: Record<string, string>; state: string }) => void;
  const ready = new Promise<{ env: Record<string, string>; state: string }>((done) => { receive = done; });
  const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/serve-local-e2e.ts"], {
    env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), WRANGLER_SEND_METRICS: "false", CI: process.env.CI ?? "", PEW_SEED_READINESS: readiness ? "true" : "false" },
    detached: true,
    ipc: (message) => receive(message as { env: Record<string, string>; state: string }),
    stdout: "inherit", stderr: "inherit",
  });
  let stop: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  const dispose = async () => {
    let code: number;
    try {
      if (child.exitCode === null) child.send("dispose");
      code = await deadline(child.exited, timeoutMs, "Local bindings disposal");
    } catch (error) {
      if (child.exitCode === null) {
        process.kill(-child.pid, "SIGKILL");
        await deadline(child.exited, timeoutMs, "Local bindings forced exit");
      }
      throw error;
    }
    if (code) throw new Error(`Local bindings process failed (${code})`);
  };
  try {
    const result = await deadline(Promise.race([ready, interrupted, child.exited.then((code) => { throw new Error(`Local bindings failed before ready (${code})`); })]), timeoutMs, "Local bindings startup");
    signal.throwIfAborted();
    return { ...result, dispose };
  } catch (error) {
    await dispose();
    throw error;
  } finally { if (stop) signal.removeEventListener("abort", stop); }
}

export async function ensurePortFree(port: string): Promise<void> {
  const numeric = Number(port);
  if (!/^\d+$/.test(port) || numeric < 1024 || numeric > 65535) throw new Error("Invalid E2E port");
  const probe = createServer();
  await new Promise<void>((done, reject) => {
    probe.once("error", reject);
    probe.listen(numeric, "127.0.0.1", () => probe.close((error) => error ? reject(error) : done()));
  });
}

export function assertNoLocalEnv(): void {
  for (const directory of [".", "packages/web"]) {
    const files = readdirSync(directory).filter((name) => /^\.env(?:$|\.)/.test(name) && !name.endsWith(".example"));
    if (files.length) throw new Error(`Isolated E2E refuses local environment files in ${directory}: ${files.join(", ")}`);
  }
}

export async function runLocalE2e(tier: "api" | "ui", args: string[] = []): Promise<number> {
  assertNoLocalEnv();
  const port = tier === "api" ? process.env.E2E_PORT ?? "17020" : process.env.E2E_UI_PORT ?? "27020";
  await ensurePortFree(port);
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("E2E interrupted"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let local: Awaited<ReturnType<typeof startLocalBindings>> | undefined;
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let tests: ReturnType<typeof Bun.spawn> | undefined;
  const killChildren = () => { server?.kill(); tests?.kill(); };
  abort.signal.addEventListener("abort", killChildren);
  const dist = tier === "api" ? ".next-e2e" : ".next-e2e-ui";
  try {
    local = await startLocalBindings(abort.signal, undefined, tier === "ui");
    abort.signal.throwIfAborted();
    const env = {
      ...local.env,
      NEXT_DIST_DIR: dist,
      E2E_TEST_USER_ID: `e2e-test-user-${local.env.PEW_TEST_RUN_ID}`,
      E2E_TEST_USER_EMAIL: `e2e-${local.env.PEW_TEST_RUN_ID}@test.invalid`,
      E2E_ADMIN_BYPASS: tier === "ui" ? "true" : "false",
      E2E_PORT: port,
      E2E_UI_PORT: port,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright"),
    };
    await verifyLocalMarker(env);
    server = Bun.spawn(["node", resolve("packages/web/node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", port], {
      cwd: "packages/web", env, stdout: "inherit", stderr: "inherit",
    });
    const started = Date.now();
    while (true) {
      abort.signal.throwIfAborted();
      if (server.exitCode !== null) throw new Error(`E2E server exited ${server.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/live`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]) });
        if (response.ok) break;
      } catch {
        abort.signal.throwIfAborted();
      }
      if (Date.now() - started > 60_000) throw new Error("E2E server readiness timed out");
      await Bun.sleep(200);
    }
    await verifyLocalMarker(env);
    tests = Bun.spawn(tier === "api"
      ? [process.execPath, "--no-env-file", "test", "packages/web/src/__tests__/e2e", "--timeout", "30000"]
      : ["node", resolve("node_modules/@playwright/test/cli.js"), "test", "--config", "packages/web/e2e/playwright.config.ts", ...args],
    { env, stdout: "inherit", stderr: "inherit" });
    return await tests.exited;
  } finally {
    for (const child of [tests, server]) {
      if (child && child.exitCode === null) {
        child.kill();
        await Promise.race([child.exited, Bun.sleep(5000)]);
        if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      }
    }
    try { await local?.dispose(); } finally {
      if (local) rmSync(join("packages/web", dist), { recursive: true, force: true });
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      abort.signal.removeEventListener("abort", killChildren);
    }
  }
}

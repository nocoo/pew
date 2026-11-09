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
// budget: timing is not part of the gate contract, and on a host running
// several other suites a healthy start has been measured at 99s. Fixed at 900s
// so a slow host cannot fail the lane. PEW_E2E_BINDINGS_TIMEOUT_MS raises it
// further without an edit per clone; a non-numeric or non-positive value keeps
// the default rather than switching the deadline off.
const DEFAULT_BINDINGS_TIMEOUT_MS = 900_000;
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
  // Dispose deadlines are capped independently of the (load-tolerant) startup
  // budget: a child that ignores IPC will not start responding sooner just
  // because startup was given a long budget. The cap keeps the failure path
  // short while still honoring a caller that passes a smaller explicit budget
  // (the no-IPC regression passes 20ms and expects disposal bounded by it).
  const disposeTimeoutMs = Math.min(timeoutMs, 30_000);
  const dispose = async () => {
    let code: number;
    try {
      if (child.exitCode === null) child.send("dispose");
      code = await deadline(child.exited, disposeTimeoutMs, "Local bindings disposal");
    } catch (error) {
      // exitCode stays null when the child was killed by a signal, so a dead
      // child must be recognized by signalCode too — otherwise this sends
      // SIGKILL to a gone process group and throws ESRCH, replacing the IPC
      // error that explains what actually happened.
      const dead = child.exitCode !== null || (child.signalCode ?? null) !== null;
      if (!dead) {
        try {
          process.kill(-child.pid, "SIGKILL");
          await deadline(child.exited, disposeTimeoutMs, "Local bindings forced exit");
        } catch (killError) {
          throw new AggregateError([error, killError], "Local bindings disposal failed and forced exit also failed");
        }
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
      // Same rationale as startLocalBindings' timeout: this guards against a
      // wedged server, not slow load. The api tier boots `next dev`, whose
      // first compile can exceed a minute when the gate runs beside the
      // browser lane's production build.
      if (Date.now() - started > 900_000) throw new Error("E2E server readiness timed out");
      await Bun.sleep(200);
    }
    await verifyLocalMarker(env);
    tests = Bun.spawn(tier === "api"
      // Per-test budget is a hang detector, not a speed gate. `next dev`
      // compiles each route on its first request and a cold compile has been
      // measured past a minute under load, so a 30s budget turns a healthy
      // lane into false failures; the documented L2 budget is 120s.
      ? [process.execPath, "--no-env-file", "test", "packages/web/src/__tests__/e2e", "--timeout", "120000"]
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

import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ensurePortFree, runLocalE2e, startLocalBindings } from "../e2e-utils";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, rmSync: vi.fn(fs.rmSync), readdirSync: vi.fn(fs.readdirSync) };
});

describe("E2E process isolation", () => {
  it.each(["api", "ui"] as const)("tolerates missing %s output without hiding other cleanup errors", async (tier) => {
    const root = mkdtempSync(join(tmpdir(), "pew-output-cleanup-"));
    const fs = await import("node:fs");
    const removePath = (await vi.importActual<typeof import("node:fs")>("node:fs")).rmSync;
    const missing = join(root, "already-removed");
    const denied = Object.assign(new Error("synthetic cleanup permission denied"), { code: "EACCES" });
    const listeners = new Map(["SIGINT", "SIGTERM"].map((event) => [event, new Set(process.listeners(event))]));
    let failRemoval = false;
    const remove = vi.mocked(fs.rmSync).mockImplementation((_path, options) => {
      if (failRemoval) throw denied;
      removePath(missing, options);
    });
    const list = vi.mocked(fs.readdirSync).mockReturnValue([]);
    const env = {
      NODE_ENV: "development", RESOURCE_ENV: "test", E2E_SKIP_AUTH: "true",
      CF_ACCOUNT_ID: "pew-local-test", CF_D1_DATABASE_ID: "pew-local-test", CF_D1_API_TOKEN: "synthetic",
      PEW_LOCAL_D1_URL: "http://127.0.0.1:12345", WORKER_INGEST_URL: "http://127.0.0.1:12345/ingest",
      WORKER_READ_URL: "http://127.0.0.1:12345", PEW_TEST_RUN_ID: "owned-run",
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true, result: [{ results: [{ key: "env", value: "test" }, { key: "run", value: "owned-run" }] }],
    })));
    vi.stubGlobal("Bun", {
      spawn: vi.fn((command: string[], options: { ipc?: (message: unknown) => void }) => {
        const exit = Promise.withResolvers<number>();
        const child = {
          pid: 123456, exitCode: null as number | null, exited: exit.promise,
          kill() { this.exitCode = 0; exit.resolve(0); },
          send() { this.kill(); },
        };
        if (options.ipc) queueMicrotask(() => options.ipc?.({ env, state: root }));
        else if (!command.includes("dev")) child.kill();
        return child;
      }),
      sleep: vi.fn(async () => {}),
    });
    try {
      await expect(runLocalE2e(tier)).resolves.toBe(0);
      expect(remove).toHaveBeenCalledExactlyOnceWith(join("packages/web", tier === "api" ? ".next-e2e" : ".next-e2e-ui"), { recursive: true, force: true });
      expect(existsSync(root)).toBe(true);
      failRemoval = true;
      await expect(runLocalE2e(tier)).rejects.toBe(denied);
    } finally {
      for (const [event, original] of listeners) {
        for (const listener of process.listeners(event)) if (!original.has(listener)) process.removeListener(event, listener);
      }
      remove.mockRestore(); list.mockRestore(); vi.unstubAllGlobals();
      removePath(root, { recursive: true });
    }
  });

  it("hands the api tier the documented 120s per-test budget", async () => {
    // Under load a single `next dev` route compile has been measured past a
    // minute on this lane, and the 30s budget turned that into a false
    // failure (24 timed-out cases on a warmed server at load ~100 that passed
    // at load ~40). The per-test budget is a hang detector, not a speed gate.
    const root = mkdtempSync(join(tmpdir(), "pew-l2-budget-"));
    mkdirSync(join(root, "packages", "web"), { recursive: true });
    const commands: string[][] = [];
    const removed = vi.mocked((await import("node:fs")).rmSync);
    const listed = vi.mocked((await import("node:fs")).readdirSync);
    const listeners = new Map(["SIGINT", "SIGTERM"].map((event) => [event, new Set(process.listeners(event))]));
    const env = {
      NODE_ENV: "development", RESOURCE_ENV: "test", E2E_SKIP_AUTH: "true",
      CF_ACCOUNT_ID: "pew-local-test", CF_D1_DATABASE_ID: "pew-local-test", CF_D1_API_TOKEN: "synthetic",
      PEW_LOCAL_D1_URL: "http://127.0.0.1:12345", WORKER_INGEST_URL: "http://127.0.0.1:12345/ingest",
      WORKER_READ_URL: "http://127.0.0.1:12345", PEW_TEST_RUN_ID: "owned-run",
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true, result: [{ results: [{ key: "env", value: "test" }, { key: "run", value: "owned-run" }] }],
    })));
    vi.stubGlobal("Bun", {
      spawn: vi.fn((command: string[], options: { ipc?: (message: unknown) => void }) => {
        const exit = Promise.withResolvers<number>();
        const child = {
          pid: 123456, exitCode: null as number | null, exited: exit.promise,
          kill() { this.exitCode = 0; exit.resolve(0); },
          send() { this.kill(); },
        };
        if (options.ipc) queueMicrotask(() => options.ipc?.({ env, state: root }));
        else if (command.includes("packages/web/src/__tests__/e2e")) { commands.push(command); child.kill(); } else if (!command.includes("dev")) child.kill();
        return child;
      }),
      sleep: vi.fn(async () => {}),
    });
    listed.mockReturnValue([]);
    removed.mockImplementation(() => {});
    try {
      await expect(runLocalE2e("api")).resolves.toBe(0);
      const testCommand = commands.find((args) => args.includes("packages/web/src/__tests__/e2e"));
      expect(testCommand).toBeDefined();
      expect(testCommand![testCommand!.indexOf("--timeout") + 1]).toBe("120000");
    } finally {
      for (const [event, original] of listeners) {
        for (const listener of process.listeners(event)) if (!original.has(listener)) process.removeListener(event, listener);
      }
      removed.mockRestore(); listed.mockRestore(); vi.unstubAllGlobals();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([false, true])("bounds no-IPC startup and disposal (abort=%s)", async (interrupt) => {
    let exit: (code: number) => void;
    const exited = new Promise<number>((done) => { exit = done; });
    const child = { pid: 123456, exitCode: null, exited, send: vi.fn() };
    const spawnChild = vi.fn(() => child);
    vi.stubGlobal("Bun", { spawn: spawnChild });
    vi.stubEnv("CI", "true");
    vi.stubEnv("PEW_SYNTHETIC_PARENT_SECRET", "must-not-forward");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { exit(137); return true; });
    try {
      const abort = new AbortController();
      const pending = startLocalBindings(abort.signal, 20);
      if (interrupt) abort.abort(new Error("synthetic interruption"));
      await expect(pending).rejects.toThrow("disposal timed out");
      expect(child.send).toHaveBeenCalledWith("dispose");
      expect(kill).toHaveBeenCalledExactlyOnceWith(-123456, "SIGKILL");
      expect(spawnChild).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ env: expect.objectContaining({ CI: "true" }) }));
      expect(spawnChild).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ env: expect.not.objectContaining({ PEW_SYNTHETIC_PARENT_SECRET: "must-not-forward" }) }));
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); kill.mockRestore(); }
  });

  it("refuses an occupied port without killing its owner", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing bound test port");
      await expect(ensurePortFree(String(address.port))).rejects.toThrow();
      expect(server.listening).toBe(true);
      await expect(ensurePortFree("17020; unsafe")).rejects.toThrow("Invalid");
    } finally { await new Promise<void>((done) => server.close(() => done())); }
  });

  it("rejects daily environment files before creating a database", async () => {
    const root = mkdtempSync(join(tmpdir(), "pew-env-test-"));
    try {
      writeFileSync(join(root, ".env.local"), "AUTH_SECRET=synthetic-test-only\n");
      const child = spawn("bun", ["--no-env-file", "-e", `import {assertNoLocalEnv} from ${JSON.stringify(join(import.meta.dirname, "../e2e-utils.ts"))}; assertNoLocalEnv();`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (data) => { stderr += data; });
      const code = await new Promise((done) => child.once("exit", done));
      expect(code).not.toBe(0);
      expect(stderr).toContain("refuses local environment files");
    } finally { rmSync(root, { recursive: true }); }
  });

  it("cleans migrated state when interrupted before binding startup", async () => {
    const root = mkdtempSync(join(tmpdir(), "pew-signal-test-"));
    const child = spawn("bun", ["--no-env-file", "scripts/run-e2e.ts"], { env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, E2E_PORT: "37020" }, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<number | null>((done) => child.once("exit", done));
    try {
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      const started = Date.now();
      while (!readdirSync(root).some((name) => name.startsWith("pew-e2e-"))) {
        if (child.exitCode !== null || Date.now() - started > 10_000) throw new Error(`No owned state created: ${output}`);
        await new Promise((done) => setTimeout(done, 50));
      }
      child.kill("SIGTERM");
      expect(await exited, output).not.toBe(0);
      expect(readdirSync(root).filter((name) => name.startsWith("pew-e2e-")), output).toEqual([]);
      expect(existsSync(root)).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; }
      rmSync(root, { recursive: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 30_000);

  it("cleans D1 and the listener after a started server is interrupted", async () => {
    const root = mkdtempSync(join(tmpdir(), "pew-started-test-"));
    const child = spawn("bun", ["--no-env-file", "scripts/run-e2e.ts"], { env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, E2E_PORT: "37021" }, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<number | null>((done) => child.once("exit", done));
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    try {
      // Poll budget is a hang detector, not a performance budget, and it must
      // sit above the runner's own 900s readiness deadline: a slower inner
      // deadline would make this report "Server did not start" instead of
      // the runner's own diagnostic.
      const started = Date.now();
      while (!output.includes("Local:")) {
        if (child.exitCode !== null || Date.now() - started > 900_000) throw new Error(`Server did not start: ${output}`);
        await new Promise((done) => setTimeout(done, 50));
      }
      child.kill("SIGTERM");
      expect(await exited, output).not.toBe(0);
      expect(readdirSync(root).filter((name) => name.startsWith("pew-e2e-")), output).toEqual([]);
      await expect(ensurePortFree("37021")).resolves.toBeUndefined();
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; }
      rmSync(root, { recursive: true, maxRetries: 3, retryDelay: 100 });
    }
    // Outer budget above the inner legal worst case: 900s readiness poll +
    // SIGTERM cleanup (5s kill wait + 30s dispose + 30s forced exit).
  }, 1_200_000);

  it("cleans D1 when the Next process fails to start", async () => {
    const root = mkdtempSync(join(tmpdir(), "pew-start-failure-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "node"), `#!/bin/sh\ncase "$1" in */next/dist/bin/next) exit 23;; esac\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
    const child = spawn("bun", ["--no-env-file", "scripts/run-e2e.ts"], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, TMPDIR: root, E2E_PORT: "37022" }, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<number | null>((done) => child.once("exit", done));
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    try {
      expect(await exited, output).not.toBe(0);
      expect(output).toContain("E2E server exited 23");
      expect(readdirSync(root).filter((name) => name.startsWith("pew-e2e-")), output).toEqual([]);
      await expect(ensurePortFree("37022")).resolves.toBeUndefined();
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; }
      rmSync(root, { recursive: true, maxRetries: 3, retryDelay: 100 });
    }
    // Inner worst case: the startup budget (900s) + 30s dispose + 30s forced
    // exit; keep the outer budget strictly above it so a wedged child surfaces
    // its own "startup timed out" diagnostic instead of a vitest timeout.
  }, 1_200_000);
});

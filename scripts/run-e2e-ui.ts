#!/usr/bin/env bun
/**
 * L4 BDD Playwright E2E UI Test Runner
 *
 * 1. Ensures port 27020 is free
 * 2. Starts Next.js dev server with E2E_SKIP_AUTH=true
 * 3. Runs Playwright tests
 * 4. Cleans up
 */

import { spawn, type Subprocess } from "bun";
import { ensurePortFree, cleanupBuildDir, loadEnvLocal, loadEnvTest } from "./e2e-utils";
import { validateAndOverride } from "./d1-test-guard";

const E2E_UI_PORT = process.env.E2E_UI_PORT || "27020";
const E2E_DIST_DIR = "packages/web/.next-e2e-ui";

let serverProcess: Subprocess | null = null;

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  const baseUrl = `http://localhost:${E2E_UI_PORT}`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanupBuildDir(E2E_DIST_DIR);
}

async function main() {
  console.log("🎭 L4 Playwright E2E UI Test Runner\n");
  await ensurePortFree(E2E_UI_PORT);

  console.log(`🌐 Starting E2E UI server on port ${E2E_UI_PORT}...`);
  const envLocal = loadEnvLocal();
  const envTest = loadEnvTest();
  const isolatedEnv = await validateAndOverride(envLocal, envTest);
  console.log("🔒 D1 test isolation verified — using pew-db-test\n");
  const mergedEnv = { ...process.env, ...isolatedEnv };
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_UI_PORT], {
    cwd: "packages/web",
    env: {
      ...mergedEnv,
      NEXT_DIST_DIR: ".next-e2e-ui",
      E2E_SKIP_AUTH: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const ready = await waitForServer();
  if (!ready) {
    console.error("❌ Server failed to start within 30s");
    await cleanup();
    process.exit(1);
  }

  console.log("✅ Server ready\n");
  console.log("🎭 Running L4 Playwright tests...\n");

  const testResult = Bun.spawnSync(
    [
      "bunx",
      "playwright",
      "test",
      "--config",
      "packages/web/e2e/playwright.config.ts",
      ...process.argv.slice(2),
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, E2E_UI_PORT },
    }
  );

  await cleanup();
  process.exit(testResult.exitCode ?? 1);
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

main();

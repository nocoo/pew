#!/usr/bin/env bun
/**
 * L3 API E2E Test Runner
 *
 * 1. Ensures port 17020 is free
 * 2. Starts Next.js dev server with E2E_SKIP_AUTH=true
 * 3. Runs API-level E2E tests
 * 4. Cleans up
 */

import { randomBytes } from "node:crypto";
import { spawn, type Subprocess } from "bun";
import { ensurePortFree, cleanupBuildDir, loadEnvLocal, loadEnvTest } from "./e2e-utils";
import { validateAndOverride } from "./d1-test-guard";

const E2E_PORT = process.env.E2E_PORT || "17020";

// Generate a unique run ID to isolate concurrent E2E runs sharing pew-db-test.
// Each run seeds/cleans its own user, so parallel CI jobs never collide.
const RUN_ID = randomBytes(4).toString("hex");
const E2E_TEST_USER_ID = `e2e-test-user-${RUN_ID}`;
const E2E_TEST_USER_EMAIL = `e2e-${RUN_ID}@test.local`;

const E2E_DIST_DIR = "packages/web/.next-e2e";

let serverProcess: Subprocess | null = null;

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  const baseUrl = `http://localhost:${E2E_PORT}`;
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
  console.log("🚀 L3 API E2E Test Runner\n");
  await ensurePortFree(E2E_PORT);

  const envLocal = loadEnvLocal();
  const envTest = loadEnvTest();
  const isolatedEnv = await validateAndOverride(envLocal, envTest);
  console.log("🔒 D1 test isolation verified — using pew-db-test");
  console.log(`🆔 E2E run isolation: ${E2E_TEST_USER_ID}\n`);
  const mergedEnv = {
    ...process.env,
    ...isolatedEnv,
    E2E_TEST_USER_ID,
    E2E_TEST_USER_EMAIL,
  };

  console.log(`🌐 Starting E2E server on port ${E2E_PORT}...`);
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_PORT], {
    cwd: "packages/web",
    env: {
      ...mergedEnv,
      NEXT_DIST_DIR: ".next-e2e",
      E2E_SKIP_AUTH: "true",
      E2E_MOCK_GITHUB: "1",
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
  console.log("🧪 Running L3 API E2E tests...\n");

  const testResult = Bun.spawnSync(
    ["bun", "test", "packages/web/src/__tests__/e2e", "--timeout", "30000"],
    {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...mergedEnv, E2E_PORT },
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

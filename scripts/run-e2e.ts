#!/usr/bin/env bun
/**
 * L3 API E2E Test Runner
 *
 * 1. Ensures port 17030 is free
 * 2. Starts Next.js dev server with E2E_SKIP_AUTH=true
 * 3. Runs API-level E2E tests
 * 4. Cleans up
 */

import { spawn, type Subprocess } from "bun";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensurePortFree, cleanupBuildDir } from "./e2e-utils";

const E2E_PORT = process.env.E2E_PORT || "17030";

/**
 * Load .env.local from packages/web so D1 credentials are available
 * to both the Next.js server and the test process.
 */
function loadEnvLocal(): Record<string, string> {
  const envPath = resolve("packages/web/.env.local");
  try {
    const content = readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      vars[key] = value;
    }
    return vars;
  } catch {
    console.warn("⚠️  Could not load packages/web/.env.local");
    return {};
  }
}
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
  const mergedEnv = { ...process.env, ...envLocal };

  console.log(`🌐 Starting E2E server on port ${E2E_PORT}...`);
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_PORT], {
    cwd: "packages/web",
    env: {
      ...mergedEnv,
      NEXT_DIST_DIR: ".next-e2e",
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

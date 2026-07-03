#!/usr/bin/env bun
/**
 * Shared E2E utilities.
 *
 * - ensurePortFree: kill any process occupying the target port
 * - cleanupBuildDir: remove build artifacts after test run
 * - loadEnvLocal: parse packages/web/.env.local for D1/auth credentials
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

/** Kill any process occupying the given port, then wait for release. */
export async function ensurePortFree(port: string): Promise<void> {
  try {
    const result = execSync(`lsof -ti:${port}`, { encoding: "utf-8" }).trim();
    if (result) {
      console.log(`⚠️  Port ${port} is occupied by PID ${result}, killing...`);
      execSync(`kill -9 ${result}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch {
    // lsof returns non-zero when no process found — port is free
  }
}

/** Remove a build directory if it exists. */
export function cleanupBuildDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`🗑️  Removed ${dir}`);
  }
}

/**
 * Load .env.local from packages/web so D1 credentials are available
 * to both the Next.js server and the test process.
 */
export function loadEnvLocal(): Record<string, string> {
  const envPath = resolve("packages/web/.env.local");
  return loadEnvFile(envPath, ".env.local");
}

/**
 * Load .env.test from packages/web for D1 test isolation overrides.
 * Contains CF_D1_DATABASE_ID_TEST, WORKER_INGEST_URL_TEST, WORKER_READ_URL_TEST.
 */
export function loadEnvTest(): Record<string, string> {
  const envPath = resolve("packages/web/.env.test");
  return loadEnvFile(envPath, ".env.test");
}

/** Shared env file parser. */
function loadEnvFile(envPath: string, label: string): Record<string, string> {
  try {
    const content = readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip a matching pair of wrapping quotes so KEY="value" parses to
      // `value`, matching how Next.js / bun / standard dotenv parsers
      // behave. Otherwise a Bearer token carries literal `"` bytes and
      // Cloudflare returns 401 despite the token itself being valid.
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  } catch {
    console.warn(`⚠️  Could not load packages/web/${label}`);
    return {};
  }
}

#!/usr/bin/env bun
/**
 * L1 cache: skip vitest if nothing relevant has changed since last green run.
 *
 * Hashes all .ts/.tsx files under packages/* /src and packages/* /scripts,
 * vitest.config.ts, and root package.json (which controls vitest version).
 * If hash matches last cached success, returns 0 immediately.
 *
 * Cache stored in .git/info/l1-cache.json (gitignored, local-only).
 * Set PEW_L1_NO_CACHE=1 to force a fresh run.
 *
 * Usage: bun run scripts/run-l1.ts <vitest args...>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = resolve(REPO_ROOT, ".git/info");
const CACHE_FILE = resolve(CACHE_DIR, "l1-cache.json");

const noCache = process.env.PEW_L1_NO_CACHE === "1";

interface L1Cache {
  hash?: string;
  vitestVersion?: string;
}

function readCache(): L1Cache {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeCache(c: L1Cache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(c));
  } catch {
    // best-effort
  }
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-e2e",
  "coverage",
  ".cache",
  ".bun",
]);
const INCLUDE_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

function walk(root: string, files: string[]): void {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) {
      walk(p, files);
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf(".");
      if (dot === -1) continue;
      const ext = e.name.slice(dot);
      if (INCLUDE_EXT.has(ext)) files.push(p);
    }
  }
}

function computeHash(): string | null {
  const files: string[] = [];
  // Source + test files for every workspace package
  for (const pkg of ["core", "cli", "web", "worker", "worker-read"]) {
    const base = resolve(REPO_ROOT, "packages", pkg);
    if (existsSync(base)) walk(base, files);
  }
  // Repo-level scripts and shared test config
  walk(resolve(REPO_ROOT, "scripts"), files);
  // Static inputs that affect test behavior
  for (const f of [
    "vitest.config.ts",
    "vitest.e2e-cli.config.ts",
    "package.json",
    "bun.lock",
  ]) {
    files.push(resolve(REPO_ROOT, f));
  }

  files.sort();
  const h = createHash("sha256");
  for (const f of files) {
    try {
      const st = statSync(f);
      h.update(f);
      h.update(":");
      h.update(String(st.size));
      h.update(":");
      // Use mtimeNs when available for finer-grained invalidation
      h.update(String(st.mtimeMs));
      h.update("\n");
    } catch {
      // missing file → skip
    }
  }
  return h.digest("hex");
}

function vitestVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "node_modules/vitest/package.json"), "utf-8"),
    );
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

const args = process.argv.slice(2);
const cache = readCache();
const hash = computeHash();
const ver = vitestVersion();

const cacheHit = !noCache && hash !== null && cache.hash === hash && cache.vitestVersion === ver;
if (cacheHit) {
  console.log(
    `⚡ L1: cached pass for ${hash.slice(0, 12)} (vitest ${ver}) (set PEW_L1_NO_CACHE=1 to force)`,
  );
  process.exit(0);
}

const r = spawnSync("vitest", ["run", "--coverage", ...args], {
  stdio: "inherit",
  shell: false,
});
const exit = r.status ?? 1;
if (exit === 0 && hash !== null) {
  writeCache({ hash, vitestVersion: ver });
}
process.exit(exit);

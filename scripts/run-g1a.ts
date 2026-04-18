#!/usr/bin/env bun
/**
 * G1a typecheck cache: skip parallel-typecheck.sh if no .ts/.tsx or tsconfig
 * has changed since last green run.
 *
 * Hashes all .ts/.tsx files under packages/* and root tsconfig*.json /
 * packages/* /tsconfig*.json. If hash matches last cached success, returns 0.
 *
 * Cache stored in .git/info/g1a-cache.json (gitignored).
 * Set PEW_G1A_NO_CACHE=1 to force a fresh run.
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
const CACHE_FILE = resolve(CACHE_DIR, "g1a-cache.json");

const noCache = process.env.PEW_G1A_NO_CACHE === "1";

interface G1aCache {
  hash?: string;
  tscVersion?: string;
}

function readCache(): G1aCache {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeCache(c: G1aCache): void {
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

function computeHash(): string {
  const files: string[] = [];
  for (const pkg of ["core", "cli", "web", "worker", "worker-read"]) {
    const base = resolve(REPO_ROOT, "packages", pkg);
    if (existsSync(base)) walk(base, files);
  }
  // tsconfig files anywhere relevant
  for (const pkg of ["core", "cli", "web", "worker", "worker-read"]) {
    const t = resolve(REPO_ROOT, "packages", pkg, "tsconfig.json");
    if (existsSync(t)) files.push(t);
  }
  for (const f of ["tsconfig.json", "package.json", "bun.lock"]) {
    const p = resolve(REPO_ROOT, f);
    if (existsSync(p)) files.push(p);
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
      h.update(String(st.mtimeMs));
      h.update("\n");
    } catch {
      // missing file → skip
    }
  }
  return h.digest("hex");
}

function tscVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "node_modules/typescript/package.json"), "utf-8"),
    );
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

const cache = readCache();
const hash = computeHash();
const ver = tscVersion();

const cacheHit = !noCache && cache.hash === hash && cache.tscVersion === ver;
if (cacheHit) {
  console.log(
    `⚡ G1a: cached typecheck pass for ${hash.slice(0, 12)} (tsc ${ver}) (set PEW_G1A_NO_CACHE=1 to force)`,
  );
  process.exit(0);
}

const r = spawnSync("bash", [resolve(REPO_ROOT, "scripts/parallel-typecheck.sh")], {
  stdio: "inherit",
  cwd: REPO_ROOT,
});
const exit = r.status ?? 1;
if (exit === 0) {
  writeCache({ hash, tscVersion: ver });
}
process.exit(exit);

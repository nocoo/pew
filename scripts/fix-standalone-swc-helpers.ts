/**
 * Next.js standalone NFT only copies the CJS files it statically traces from
 * @swc/helpers. @swc/helpers@0.5.23 added a `module-sync` export condition, so
 * Node 22+ `require("@swc/helpers/_/...")` resolves to the ESM path instead of
 * CJS. Railway boots `node packages/web/server.js` from the standalone tree and
 * crashes with MODULE_NOT_FOUND for esm/_interop_require_default.js.
 *
 * Copy the full package from bun's install layout into standalone after build.
 */
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function findSwcHelpersDirs(bunModulesDir: string): string[] {
  if (!existsSync(bunModulesDir)) return [];
  const results: string[] = [];
  for (const name of readdirSync(bunModulesDir)) {
    if (!name.startsWith("@swc+helpers@")) continue;
    const helpers = join(bunModulesDir, name, "node_modules", "@swc", "helpers");
    if (existsSync(helpers)) results.push(helpers);
  }
  return results;
}

export function versionFromHelpersPath(helpersPath: string): string | null {
  const match = helpersPath.match(/@swc\+helpers@([^/]+)/);
  return match?.[1] ?? null;
}

export function copyFullSwcHelpers(sourceDir: string, destDir: string): void {
  for (const entry of readdirSync(sourceDir)) {
    const from = join(sourceDir, entry);
    const to = join(destDir, entry);
    if (existsSync(to)) {
      rmSync(to, { recursive: true, force: true });
    }
    cpSync(from, to, { recursive: true });
  }
}

export function fixStandaloneSwcHelpers(opts?: {
  rootDir?: string;
  /** When true, missing standalone is an error (Docker/prod). Default: soft skip. */
  required?: boolean;
}): { fixed: string[]; skipped: boolean } {
  const rootDir = opts?.rootDir ?? root;
  const required = opts?.required ?? false;
  const sourceBun = join(rootDir, "node_modules", ".bun");
  const standaloneBun = join(
    rootDir,
    "packages",
    "web",
    ".next",
    "standalone",
    "node_modules",
    ".bun",
  );

  if (!existsSync(standaloneBun)) {
    if (required) {
      throw new Error(
        `fix-standalone-swc-helpers: standalone missing at ${standaloneBun}`,
      );
    }
    return { fixed: [], skipped: true };
  }

  const sources = findSwcHelpersDirs(sourceBun);
  const dests = findSwcHelpersDirs(standaloneBun);

  if (sources.length === 0) {
    throw new Error(
      "fix-standalone-swc-helpers: source @swc/helpers not found under node_modules/.bun",
    );
  }
  if (dests.length === 0) {
    throw new Error(
      "fix-standalone-swc-helpers: standalone @swc/helpers not found (NFT layout changed?)",
    );
  }

  const fixed: string[] = [];
  for (const dest of dests) {
    const version = versionFromHelpersPath(dest);
    const src =
      sources.find((s) => versionFromHelpersPath(s) === version) ?? sources[0];
    copyFullSwcHelpers(src, dest);

    const probe = join(dest, "esm", "_interop_require_default.js");
    if (!existsSync(probe)) {
      throw new Error(
        `fix-standalone-swc-helpers: missing ${probe} after copy from ${src}`,
      );
    }
    fixed.push(dest);
  }

  return { fixed, skipped: false };
}

if (import.meta.main) {
  const required = process.argv.includes("--required");
  const result = fixStandaloneSwcHelpers({ required });
  if (result.skipped) {
    console.log("fix-standalone-swc-helpers: no standalone output, skipped");
  } else {
    for (const dest of result.fixed) {
      console.log(`fix-standalone-swc-helpers: patched ${dest}`);
    }
  }
}

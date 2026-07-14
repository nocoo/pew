#!/usr/bin/env bun
/**
 * Static guard: (1) every `@ts-expect-error` carries a description of
 * at least MIN_LENGTH characters (matching tseslint `ban-ts-comment`'s
 * `minimumDescriptionLength` default); (2) `@ts-nocheck` is banned
 * outright — it disables ALL type-checking for the whole file and is
 * a strictly weaker escape hatch than a targeted expect-error.
 *
 * tseslint's `ban-ts-comment` (strict tier) enforces both. biome 2.5's
 * `noTsIgnore` blocks the ts-ignore directive but leaves both of the
 * above untouched. This script closes that gap.
 *
 * Uses `oxc-parser`, which surfaces every source-file comment
 * (line + block) with precise position info — the TypeScript 7
 * (native / preview) module ships in a "not ready" state and no
 * longer exposes a standalone `createScanner`.
 */

import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseSync } from "oxc-parser";

const REPO_ROOT = process.env.PEW_GATE_ROOT ?? join(import.meta.dir, "..");

// Whole-repo scan; the linter that used to run this gate (eslint strict)
// ran against everything, so we mirror that scope. Sub-tree excludes are
// applied inside walk().
//
// pre-commit sets PEW_GATE_ROOT to a temp dir populated via
// `git checkout-index` so the gate scans the INDEX snapshot rather than
// the working tree — see .husky/pre-commit.
const ROOTS = [REPO_ROOT];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-e2e",
  ".next-e2e-ui",
  "coverage",
  "__golden__",
  ".git",
  ".husky",
  ".claude",
  ".wrangler",
]);

const MIN_LENGTH = 10;

interface Violation {
  path: string;
  line: number;
  reason: "missing" | "too_short" | "ts_nocheck";
  found: string;
}

interface OxcComment {
  type: "Line" | "Block";
  value: string;
  start: number;
  end: number;
}

function posToLine(src: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

function scanFile(path: string, src: string): Violation[] {
  const violations: Violation[] = [];
  const r = parseSync(path, src);
  if (r.errors.length > 0) {
    for (const err of r.errors) {
      console.error(`✗ parse error ${path}: ${err.message}`);
    }
    process.exit(1);
  }
  const comments = (r.comments ?? []) as unknown as OxcComment[];

  // Only pragma-style directives count: after `//`, `///` or `/*`, the very
  // first non-whitespace token must be `@ts-<name>`. `*` is allowed as a
  // JSDoc continuation marker; a leading `/` covers oxc-parser's quirk of
  // representing `/// @ts-nocheck` as a Line comment whose value starts
  // with `/` (the third slash). Prose mentions like "@ts-nocheck is
  // banned" in longer comments must NOT false-positive.
  const NOCHECK_RE = /^\s*[/*]?\s*@ts-nocheck\b/;
  const EXPECT_RE = /^\s*[/*]?\s*@ts-expect-error\b(.*)$/s;

  for (const c of comments) {
    if (NOCHECK_RE.test(c.value)) {
      violations.push({
        path,
        line: posToLine(src, c.start),
        reason: "ts_nocheck",
        found: c.value.trim(),
      });
      continue;
    }
    const m = EXPECT_RE.exec(c.value);
    if (!m) continue;
    let rest = m[1] ?? "";
    if (c.type === "Block") rest = rest.replace(/\n\s*\*?/g, " ");
    rest = rest.replace(/^\s*[-–—:]?\s*/, "").trim();
    if (rest.length === 0) {
      violations.push({
        path,
        line: posToLine(src, c.start),
        reason: "missing",
        found: "",
      });
    } else if (rest.length < MIN_LENGTH) {
      violations.push({
        path,
        line: posToLine(src, c.start),
        reason: "too_short",
        found: rest,
      });
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const violations: Violation[] = [];
  let scannedCount = 0;

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const s = await stat(full);
      if (s.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        await walk(full);
      } else if (/\.(tsx|ts|mts|cts)$/.test(name)) {
        scannedCount++;
        const src = readFileSync(full, "utf-8");
        const repoRel = relative(REPO_ROOT, full);
        for (const v of scanFile(repoRel, src)) violations.push(v);
      }
    }
  }

  for (const root of ROOTS) await walk(root);

  if (scannedCount === 0) {
    console.error(
      `FATAL: scanned 0 files under ${ROOTS.join(", ")} — misconfigured?`,
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      `✓ no @ts-nocheck; every @ts-expect-error carries a ≥${MIN_LENGTH}-char explanation (${scannedCount} files scanned)`,
    );
    process.exit(0);
  }

  console.error(
    `✗ ts directive violations (${violations.length}):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line}  [${v.reason}]`);
    if (v.reason === "too_short") {
      console.error(`    found: "${v.found}" (${v.found.length} chars)`);
    } else if (v.reason === "ts_nocheck") {
      console.error(`    @ts-nocheck disables all type-checking for the whole file — use targeted @ts-expect-error instead`);
    }
  }
  console.error(
    `\n  For @ts-expect-error, add a short reason: \`// @ts-expect-error - <why, ≥${MIN_LENGTH} chars>\``,
  );
  console.error(
    "  @ts-nocheck is banned outright.",
  );
  process.exit(1);
}

void main();

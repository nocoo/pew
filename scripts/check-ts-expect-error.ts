#!/usr/bin/env bun
/**
 * Static guard: every `@ts-expect-error` must carry a description of
 * at least MIN_LENGTH characters (matching tseslint `ban-ts-comment`'s
 * `minimumDescriptionLength` default).
 *
 * tseslint's `ban-ts-comment` (strict tier) enforces this. biome 2.5's
 * `noTsIgnore` blocks the ts-ignore directive outright but doesn't require
 * descriptions on `@ts-expect-error`.
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

const REPO_ROOT = join(import.meta.dir, "..");

const ROOTS = [
  join(REPO_ROOT, "packages", "core", "src"),
  join(REPO_ROOT, "packages", "cli", "src"),
  join(REPO_ROOT, "packages", "web", "src"),
  join(REPO_ROOT, "packages", "worker", "src"),
  join(REPO_ROOT, "packages", "worker-read", "src"),
];

const MIN_LENGTH = 10;

interface Violation {
  path: string;
  line: number;
  reason: "missing" | "too_short";
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

  for (const c of comments) {
    const idx = c.value.indexOf("@ts-expect-error");
    if (idx === -1) continue;
    let rest = c.value.slice(idx + "@ts-expect-error".length);
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
        if (
          name === "node_modules" ||
          name === "coverage" ||
          name === ".next" ||
          name === "__golden__"
        ) {
          continue;
        }
        await walk(full);
      } else if (/\.(tsx|ts)$/.test(name)) {
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
      `✓ every @ts-expect-error carries a ≥${MIN_LENGTH}-char explanation (${scannedCount} files scanned)`,
    );
    process.exit(0);
  }

  console.error(
    `✗ @ts-expect-error violations (${violations.length}, min ${MIN_LENGTH} chars):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line}  [${v.reason}]`);
    if (v.reason === "too_short") {
      console.error(`    found: "${v.found}" (${v.found.length} chars)`);
    }
  }
  console.error(
    `\n  Add a short reason: \`// @ts-expect-error - <why, ≥${MIN_LENGTH} chars>\``,
  );
  process.exit(1);
}

void main();

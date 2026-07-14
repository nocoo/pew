#!/usr/bin/env bun
/**
 * Static guard against dynamic `delete obj[computed]`.
 *
 * Rationale: `delete obj[key]` hides property removal from the type
 * system and defeats optimizer inlining. tseslint's `no-dynamic-delete`
 * (strict tier) blocks `delete obj[computed]` but permits
 * `delete obj.staticName` and `delete obj["static-literal"]`.
 *
 * Uses `oxc-parser` (Rust-native, ESTree AST) rather than the
 * `typescript` compiler API. Reason: TypeScript 7 (native / preview)
 * has "not ready" status for its consumer API and no longer exposes
 * a standalone `createSourceFile` / `forEachChild`. oxc gives us a
 * stable single-file parse that works regardless of what typescript
 * version tsc itself is at.
 *
 * biome 2.5 has no equivalent — `noDelete` is a blanket ban and
 * would fire on legitimate `Record<string, unknown>` deletes. This
 * script + that gap is the smallest wedge to reach strict parity.
 *
 * Extend ALLOWED_SITES with justified sites (each entry requires a reason).
 * Keys are `${repoRelPath}:${1-indexed-line}` — per-line, NOT per-file, so
 * new dynamic deletes in the same file still trigger.
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

// Whitelist: `${repoRelPath}:${line}` → reason. Line is 1-indexed and
// points at the `delete` statement itself. Per-line, so a new violation in
// the same file will NOT be silently allowed.
const ALLOWED_SITES: Record<string, string> = {
  "packages/cli/src/notifier/claude-hook.ts:128":
    "hook cleanup: dynamic key = EVENT_NAME const, guaranteed present via prior check",
  "packages/cli/src/notifier/gemini-hook.ts:136":
    "hook cleanup: dynamic key = EVENT_NAME const, guaranteed present via prior check",
  "packages/cli/src/notifier/openclaw-hook.ts:113":
    "hook cleanup: dynamic key = PLUGIN_ID const",
  "packages/cli/src/notifier/openclaw-hook.ts:135":
    "hook cleanup: dynamic key = installs entry from a loop over Object.entries",
  "packages/cli/src/__tests__/sync.test.ts:1752":
    "test fixture: delete synthetic cursor entry keyed by dynamically-built path",
  "packages/cli/src/__tests__/sync.test.ts:2643":
    "test fixture: delete synthetic cursor entry keyed by dynamically-built path",
};

interface Violation {
  path: string;
  line: number;
  col: number;
  snippet: string;
}

interface Loc {
  line: number;
  column: number;
}

interface OxcNode {
  type: string;
  start?: number;
  end?: number;
  loc?: { start: Loc; end: Loc };
  operator?: string;
  argument?: OxcNode;
  expression?: OxcNode;
  object?: OxcNode;
  property?: OxcNode;
  computed?: boolean;
  [key: string]: unknown;
}

function isDynamicComputedTail(expr: OxcNode | undefined): boolean {
  if (!expr) return false;
  let cur = expr;
  while (
    cur.type === "ParenthesizedExpression" ||
    cur.type === "TSNonNullExpression" ||
    cur.type === "ChainExpression"
  ) {
    cur = cur.expression as OxcNode;
  }
  if (cur.type !== "MemberExpression") return false;
  if (!cur.computed) return false;
  const prop = cur.property;
  if (!prop) return false;
  if (prop.type === "Literal") return false;
  if (prop.type === "TemplateLiteral") {
    const q = prop as unknown as { expressions: unknown[] };
    if (Array.isArray(q.expressions) && q.expressions.length === 0) return false;
  }
  return true;
}

function posToLine(src: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

function posToCol(src: string, pos: number): number {
  let col = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (src.charCodeAt(i) === 10) break;
    col++;
  }
  return col;
}

function collect(
  node: OxcNode | null | undefined,
  path: string,
  src: string,
  out: Violation[],
): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "UnaryExpression" && node.operator === "delete") {
    if (isDynamicComputedTail(node.argument)) {
      const startPos = node.start ?? 0;
      const line = node.loc?.start.line ?? posToLine(src, startPos);
      const col = node.loc?.start.column ?? posToCol(src, startPos);
      const endPos = node.end ?? startPos;
      const site = `${path}:${line}`;
      if (!(site in ALLOWED_SITES)) {
        out.push({
          path,
          line,
          col: col + 1,
          snippet: (src.slice(startPos, endPos).split("\n")[0] ?? "").trim(),
        });
      }
    }
  }
  for (const key in node) {
    if (key === "loc" || key === "start" || key === "end" || key === "type") continue;
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) collect(item as OxcNode, path, src, out);
    } else if (value && typeof value === "object" && "type" in (value as object)) {
      collect(value as OxcNode, path, src, out);
    }
  }
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
      } else if (/\.(tsx|ts)$/.test(name)) {
        scannedCount++;
        const src = readFileSync(full, "utf-8");
        const repoRel = relative(REPO_ROOT, full);
        const r = parseSync(full, src);
        if (r.errors.length > 0) {
          for (const err of r.errors) {
            console.error(`✗ parse error ${repoRel}: ${err.message}`);
          }
          process.exit(1);
        }
        collect(r.program as unknown as OxcNode, repoRel, src, violations);
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
      `✓ no dynamic delete found (${scannedCount} files scanned, ${Object.keys(ALLOWED_SITES).length} whitelisted)`,
    );
    process.exit(0);
  }

  console.error(
    `✗ dynamic delete forbidden (${violations.length} site${violations.length === 1 ? "" : "s"}):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line}:${v.col}`);
    console.error(`    ${v.snippet}`);
  }
  console.error(
    "\n  Use a static property name, or refactor to a Map/Record helper.",
  );
  console.error(
    "  If truly necessary, add a `" + "$" + "{repoRelPath}:$" + "{line}` entry to ALLOWED_SITES with a reason.",
  );
  process.exit(1);
}

void main();

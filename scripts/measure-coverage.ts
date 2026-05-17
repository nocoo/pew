#!/usr/bin/env bun
/**
 * Coverage + complexity measurement for autoresearch.
 * - Runs `vitest run --coverage` (no cache) and parses the "All files" row.
 * - Counts source files > 400 lines and functions > 100 lines (approx).
 * - Emits METRIC lines for run_experiment to parse:
 *     METRIC branches=<pct>
 *     METRIC lines=<pct>
 *     METRIC statements=<pct>
 *     METRIC functions=<pct>
 *     METRIC files_over_400=<n>
 *     METRIC funcs_over_100=<n>
 *     METRIC tests_passed=<n>
 *     METRIC tests_failed=<n>
 *
 * Primary optimisation target: branches (lowest of the four coverage axes).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next" || name === "__tests__") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (
      p.endsWith(".ts") &&
      !p.endsWith(".test.ts") &&
      !p.endsWith(".d.ts") &&
      !p.endsWith(".test.tsx")
    ) {
      out.push(p);
    }
  }
  return out;
}

function countComplexity(files: string[]): { filesOver400: number; funcsOver100: number } {
  let filesOver400 = 0;
  let funcsOver100 = 0;
  // Crude function detector — counts function/method bodies whose `{...}` brace span
  // exceeds 100 lines. Good enough as a regression signal; not a substitute for
  // a real AST tool.
  const fnHead = /(?:function\s+\w+|=\s*(?:async\s*)?\(?[^)]*\)?\s*=>|(?:async\s+)?\w+\s*\([^)]*\)\s*[:{])/;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const lines = src.split("\n");
    if (lines.length > 400) filesOver400++;
    // Simple brace-balanced function span detection.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!fnHead.test(line)) continue;
      // Find the opening `{` on this line or the next few.
      let openLine = -1;
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        const idx = lines[j].indexOf("{");
        if (idx !== -1 && !lines[j].slice(0, idx).includes("//")) {
          openLine = j;
          break;
        }
      }
      if (openLine === -1) continue;
      let depth = 0;
      let started = false;
      let endLine = -1;
      for (let j = openLine; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") {
            depth++;
            started = true;
          } else if (ch === "}") {
            depth--;
            if (started && depth === 0) {
              endLine = j;
              break;
            }
          }
        }
        if (endLine !== -1) break;
      }
      if (endLine !== -1 && endLine - openLine > 100) funcsOver100++;
    }
  }
  return { filesOver400, funcsOver100 };
}

function parseCoverage(output: string): {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  testsPassed: number;
  testsFailed: number;
  coverageParsed: boolean;
} {
  // Tests line: "Tests  4004 passed (4004)" or with failures
  const passMatch = output.match(/Tests[^\n]*?(\d+)\s+passed/);
  const failMatch = output.match(/(\d+)\s+failed/);
  const testsPassed = passMatch ? Number(passMatch[1]) : 0;
  const testsFailed = failMatch ? Number(failMatch[1]) : 0;

  // "All files          |   98.29 |    94.19 |   98.67 |   98.98 |"
  const allFiles = output.split("\n").reverse().find((l) => /^All files\s*\|/.test(l));
  if (!allFiles) {
    return {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
      testsPassed,
      testsFailed,
      coverageParsed: false,
    };
  }
  const parts = allFiles.split("|").map((s) => s.trim());
  const statements = Number(parts[1]);
  const branches = Number(parts[2]);
  const functions = Number(parts[3]);
  const lines = Number(parts[4]);
  // Treat NaN/Infinity in any of the four numbers as a parse failure.
  // (e.g. if Vitest changes its reporter format and the "All files" row
  //  no longer has four percent columns in the expected slots.)
  const coverageParsed = [statements, branches, functions, lines].every(
    (n) => Number.isFinite(n),
  );
  return {
    statements,
    branches,
    functions,
    lines,
    testsPassed,
    testsFailed,
    coverageParsed,
  };
}

const result = spawnSync("bun", ["run", "test:coverage"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, PEW_L1_NO_CACHE: "1" },
  maxBuffer: 64 * 1024 * 1024,
});

const out = (result.stdout ?? "") + "\n" + (result.stderr ?? "");
const cov = parseCoverage(out);
const files = walk("packages/cli/src")
  .concat(walk("packages/web/src"))
  .concat(walk("packages/worker/src"))
  .concat(walk("packages/worker-read/src"))
  .concat(walk("packages/core/src"));
const cx = countComplexity(files);

// Echo a compact tail of vitest output for debugging.
const tail = out.split("\n").slice(-20).join("\n");
console.log(tail);

console.log(`METRIC branches=${cov.branches}`);
console.log(`METRIC lines=${cov.lines}`);
console.log(`METRIC statements=${cov.statements}`);
console.log(`METRIC functions=${cov.functions}`);
console.log(`METRIC files_over_400=${cx.filesOver400}`);
console.log(`METRIC funcs_over_100=${cx.funcsOver100}`);
console.log(`METRIC tests_passed=${cov.testsPassed}`);
console.log(`METRIC tests_failed=${cov.testsFailed}`);

// Exit non-zero if any tests failed, Vitest exited non-zero, OR the coverage
// summary row couldn't be parsed (e.g. reporter format changed). Without this
// guard, autoresearch would record an all-zero measurement as a successful run.
if (cov.testsFailed > 0 || result.status !== 0 || !cov.coverageParsed) {
  if (!cov.coverageParsed) {
    console.error(
      "[measure-coverage] failed to parse coverage summary row from Vitest output",
    );
  }
  process.exit(1);
}
process.exit(0);

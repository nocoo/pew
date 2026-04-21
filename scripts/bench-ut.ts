#!/usr/bin/env bun
/**
 * Autoresearch UT benchmark.
 *
 * Runs vitest run --coverage N times (cold, no L1 cache), reports:
 *   METRIC ut_median_s=...      (primary; lower is better)
 *   METRIC ut_min_s=...
 *   METRIC ut_max_s=...
 *   METRIC ut_stddev_s=...      (stability; lower is better)
 *   METRIC coverage_stmts=...   (must be ≥95)
 *   METRIC coverage_branches=...
 *   METRIC coverage_funcs=...   (must be ≥95)
 *   METRIC coverage_lines=...   (must be ≥95)
 *   METRIC test_count=...
 *   METRIC file_count=...
 *
 * Exits non-zero on failure or coverage regression below the floors.
 */
import { spawnSync } from "node:child_process";

const RUNS = Number(process.env.BENCH_RUNS || 3);
const COVERAGE_FLOORS = {
  stmts: 95,
  funcs: 95,
  lines: 95,
};

interface RunResult {
  durationS: number;
  testCount: number;
  fileCount: number;
  cov: { stmts: number; branches: number; funcs: number; lines: number } | null;
  ok: boolean;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

function parseRun(raw: string): RunResult {
  const out = stripAnsi(raw);
  // Duration line: "   Duration  6.20s (transform ..."
  const dur = out.match(/Duration\s+([\d.]+)s/);
  const tests = out.match(/Tests\s+(\d+)\s+passed/);
  const files = out.match(/Test Files\s+(\d+)\s+passed/);
  // Coverage "All files" row: "All files | stmts | branches | funcs | lines |"
  const all = out.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  return {
    durationS: dur ? Number(dur[1]) : 0,
    testCount: tests ? Number(tests[1]) : 0,
    fileCount: files ? Number(files[1]) : 0,
    cov: all
      ? {
          stmts: Number(all[1]),
          branches: Number(all[2]),
          funcs: Number(all[3]),
          lines: Number(all[4]),
        }
      : null,
    ok: !!dur && !!tests && !!all,
  };
}

const results: RunResult[] = [];
for (let i = 0; i < RUNS; i++) {
  const start = Date.now();
  const r = spawnSync(
    "bun",
    ["x", "vitest", "run", "--coverage"],
    {
      stdio: "pipe",
      env: { ...process.env, PEW_L1_NO_CACHE: "1", CI: "1", FORCE_COLOR: "0" },
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 64,
    },
  );
  const wallS = (Date.now() - start) / 1000;
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0) {
    process.stderr.write(out.slice(-4000));
    console.log(`METRIC run_${i}_failed=1`);
    process.exit(1);
  }
  const parsed = parseRun(out);
  if (!parsed.ok) {
    process.stderr.write(out.slice(-4000));
    console.error("Failed to parse vitest output");
    process.exit(1);
  }
  // Prefer parsed Duration (vitest internal) but fall back to wall if missing
  if (!parsed.durationS) parsed.durationS = wallS;
  results.push(parsed);
  console.error(
    `run ${i + 1}/${RUNS}: ${parsed.durationS.toFixed(2)}s  files=${parsed.fileCount}  tests=${parsed.testCount}  cov=${parsed.cov?.stmts}/${parsed.cov?.branches}/${parsed.cov?.funcs}/${parsed.cov?.lines}`,
  );
}

const durs = results.map((r) => r.durationS).sort((a, b) => a - b);
const median = durs[Math.floor(durs.length / 2)];
const min = durs[0];
const max = durs[durs.length - 1];
const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
const variance = durs.reduce((a, b) => a + (b - mean) ** 2, 0) / durs.length;
const stddev = Math.sqrt(variance);

const last = results[results.length - 1];
const cov = last?.cov ?? { stmts: 0, branches: 0, funcs: 0, lines: 0 };

console.log(`METRIC ut_median_s=${median.toFixed(3)}`);
console.log(`METRIC ut_min_s=${min.toFixed(3)}`);
console.log(`METRIC ut_max_s=${max.toFixed(3)}`);
console.log(`METRIC ut_stddev_s=${stddev.toFixed(3)}`);
console.log(`METRIC coverage_stmts=${cov.stmts}`);
console.log(`METRIC coverage_branches=${cov.branches}`);
console.log(`METRIC coverage_funcs=${cov.funcs}`);
console.log(`METRIC coverage_lines=${cov.lines}`);
console.log(`METRIC test_count=${last?.testCount ?? 0}`);
console.log(`METRIC file_count=${last?.fileCount ?? 0}`);

// Enforce coverage floors (statements, functions, lines).
const fails: string[] = [];
if (cov.stmts < COVERAGE_FLOORS.stmts) fails.push(`stmts ${cov.stmts}<${COVERAGE_FLOORS.stmts}`);
if (cov.funcs < COVERAGE_FLOORS.funcs) fails.push(`funcs ${cov.funcs}<${COVERAGE_FLOORS.funcs}`);
if (cov.lines < COVERAGE_FLOORS.lines) fails.push(`lines ${cov.lines}<${COVERAGE_FLOORS.lines}`);
if (fails.length) {
  console.error(`Coverage floor violation: ${fails.join(", ")}`);
  process.exit(2);
}

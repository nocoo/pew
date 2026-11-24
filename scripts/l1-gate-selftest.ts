#!/usr/bin/env bun
/**
 * L1 pre-commit gate self-test: negative probes in an isolated worktree with
 * read-only node_modules reuse, optional timing on the invoking repository.
 *
 * Usage:
 *   bun scripts/l1-gate-selftest.ts           # probes only
 *   bun scripts/l1-gate-selftest.ts --measure # add cold/warm pre-commit timing
 */

import { spawnSync } from "node:child_process";
import {
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCoverageText, probePassed } from "./l1-gate-selftest-lib.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(repoRoot, ".husky", "pre-commit");
const probeSource = join(repoRoot, "packages/core/src/l1-probe.ts");
const probeTest = join(repoRoot, "packages/core/src/l1-probe.test.ts");

const PROBE_REL_SOURCE = "packages/core/src/l1-probe.ts";
const PROBE_REL_TEST = "packages/core/src/l1-probe.test.ts";

type ProbeResult = {
	id: string;
	expectReject: boolean;
	status: number | null;
	signal: NodeJS.Signals | null;
	ok: boolean;
	detail: string;
};

type MeasureResult = {
	coldMs: number;
	warmMs: number;
	coldExit: number | null;
	warmExit: number | null;
	coverage: ReturnType<typeof parseCoverageText> | null;
};

function git(args: string[], cwd: string) {
	return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function bunDir(): string {
	const which = spawnSync("sh", ["-c", "command -v bun"], {
		encoding: "utf8",
	}).stdout.trim();
	if (!which) {
		throw new Error("bun is required on PATH for l1-gate-selftest");
	}
	return dirname(which);
}

function runHook(
	cwd: string,
	env: NodeJS.ProcessEnv = {},
	timeoutMs?: number,
): spawnSync.SpawnSyncReturns<string> {
	return spawnSync("/bin/sh", ["-e", hook], {
		cwd,
		env: {
			...process.env,
			PATH: `${bunDir()}:${repoRoot}/node_modules/.bin:${process.env.PATH ?? ""}`,
			...env,
		},
		encoding: "utf8",
		timeout: timeoutMs,
	});
}

function readProbeBaseline(): { source: string; test: string } {
	return {
		source: readFileSync(probeSource, "utf8"),
		test: readFileSync(probeTest, "utf8"),
	};
}

function stageFile(wt: string, rel: string, body: string): void {
	writeFileSync(join(wt, rel), body);
	const r = git(["add", rel], wt);
	if (r.status !== 0) {
		throw new Error(`git add failed: ${r.stderr}`);
	}
}

function stageIndexOnlyGoodWorktree(
	wt: string,
	rel: string,
	stagedBody: string,
	worktreeBody: string,
): void {
	writeFileSync(join(wt, rel), stagedBody);
	git(["add", rel], wt);
	writeFileSync(join(wt, rel), worktreeBody);
}

function resetProbe(wt: string, baseline: { source: string; test: string }): void {
	writeFileSync(join(wt, PROBE_REL_SOURCE), baseline.source);
	writeFileSync(join(wt, PROBE_REL_TEST), baseline.test);
	git(["reset", "HEAD", "--", PROBE_REL_SOURCE, PROBE_REL_TEST], wt);
	git(["checkout", "--", PROBE_REL_SOURCE, PROBE_REL_TEST], wt);
}

function setupWorktree(): { wt: string; cleanup: () => void } {
	const owned = mkdtempSync(join(tmpdir(), "pew-l1-selftest-"));
	const wt = join(owned, "wt");
	const add = git(["-C", repoRoot, "worktree", "add", "--detach", wt, "HEAD"], repoRoot);
	if (add.status !== 0) {
		throw new Error(`worktree add failed: ${add.stderr}`);
	}
	git(["config", "user.email", "l1-selftest@pew.local"], wt);
	git(["config", "user.name", "l1-gate-selftest"], wt);
	const link = spawnSync(
		"sh",
		[join(repoRoot, "scripts/snapshot-node-modules.sh"), repoRoot, wt],
		{ encoding: "utf8" },
	);
	if (link.status !== 0) {
		throw new Error(`snapshot-node-modules failed: ${link.stderr}`);
	}
	return {
		wt,
		cleanup: () => {
			git(["-C", repoRoot, "worktree", "remove", "--force", wt], repoRoot);
			rmSync(owned, { recursive: true, force: true });
		},
	};
}

function runProbes(wt: string, baseline: { source: string; test: string }): ProbeResult[] {
	const results: ProbeResult[] = [];
	const push = (
		id: string,
		expectReject: boolean,
		run: ReturnType<typeof runHook>,
		extraOk = true,
		detail = "",
	) => {
		results.push({
			id,
			expectReject,
			status: run.status,
			signal: run.signal,
			ok: probePassed(expectReject, run.status, run.signal, extraOk),
			detail,
		});
	};

	const pkgGood = readFileSync(join(repoRoot, "package.json"), "utf8");
	stageIndexOnlyGoodWorktree(wt, "package.json", `${pkgGood}\n`, pkgGood);
	push("staged-manifest-drift", true, runHook(wt), true, "manifest guard");
	git(["reset", "HEAD", "--", "package.json"], wt);
	git(["checkout", "--", "package.json"], wt);

	stageFile(
		wt,
		PROBE_REL_TEST,
		baseline.test.replace("expect(l1ProbeOk()).toBe(true)", "expect(l1ProbeOk()).toBe(false)"),
	);
	push("missing-bun", true, runHook(wt, { PATH: "/usr/bin:/bin" }), true, "PATH without bun");
	resetProbe(wt, baseline);

	const interrupted = runHook(wt, {}, 3_000);
	push(
		"timeout-interrupt",
		true,
		interrupted,
		interrupted.status !== 0 ||
			interrupted.signal === "SIGTERM" ||
			interrupted.error?.message.includes("ETIMEDOUT") === true,
		interrupted.error?.message ?? interrupted.signal ?? String(interrupted.status),
	);
	resetProbe(wt, baseline);

	stageIndexOnlyGoodWorktree(
		wt,
		PROBE_REL_TEST,
		baseline.test.replace("expect(l1ProbeOk()).toBe(true)", "expect(l1ProbeOk()).toBe(false)"),
		baseline.test,
	);
	const isolated = runHook(wt);
	const isolatedOut = isolated.stdout + isolated.stderr;
	const sawStagedTestFailure =
		isolatedOut.includes("l1-probe.test.ts") || isolatedOut.includes("FAIL");
	push(
		"index-bad-worktree-good",
		true,
		isolated,
		sawStagedTestFailure,
		`checkout-index staged_test_failed=${sawStagedTestFailure}`,
	);
	resetProbe(wt, baseline);

	return results;
}

function clearRunnerCaches(): void {
	for (const dir of [
		join(repoRoot, "node_modules/.cache/vitest"),
		join(repoRoot, "node_modules/.cache/xdg"),
	]) {
		rmSync(dir, { recursive: true, force: true });
	}
}

function measurePreCommit(): MeasureResult {
	clearRunnerCaches();
	const coldT0 = Date.now();
	const coldRun = runHook(repoRoot);
	const coldMs = Date.now() - coldT0;
	const warmT0 = Date.now();
	const warmRun = runHook(repoRoot);
	const warmMs = Date.now() - warmT0;
	return {
		coldMs,
		warmMs,
		coldExit: coldRun.status,
		warmExit: warmRun.status,
		coverage: parseCoverageText(coldRun.stdout + coldRun.stderr),
	};
}

function main(): void {
	const measure = process.argv.includes("--measure");
	const baseline = readProbeBaseline();
	const { wt, cleanup } = setupWorktree();
	let probeResults: ProbeResult[] = [];
	try {
		probeResults = runProbes(wt, baseline);
	} finally {
		cleanup();
	}

	const failures = probeResults.filter((p) => !p.ok);
	if (failures.length > 0) {
		for (const f of failures) {
			console.error(`PROBE FAIL ${f.id}: ${f.detail} status=${f.status} signal=${f.signal}`);
		}
		process.exit(1);
	}

	const timings = measure ? measurePreCommit() : null;
	const report = { probes: probeResults, measure: timings };
	console.log(JSON.stringify(report, null, 2));

	if (timings && (timings.coldExit !== 0 || timings.warmExit !== 0)) {
		console.error("measure: pre-commit did not pass on the invoking worktree");
		process.exit(1);
	}
}

main();

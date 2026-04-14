#!/usr/bin/env bun
/**
 * G2 Security Gate
 * 1. osv-scanner: dependency CVE scan (bun.lock)
 * 2. gitleaks: secret leak scan (unpushed commits)
 *
 * Single source of truth — called by both `bun run test:security`
 * and `.husky/pre-push`.
 *
 * Default: tool missing → hard failure with install instructions.
 * Set PEW_G2_SOFT=1 for soft-degrade mode (warn and skip).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const softMode = process.env.PEW_G2_SOFT === "1";

interface ToolSpec {
  name: string;
  install: string;
}

const TOOLS: Record<string, ToolSpec> = {
  "osv-scanner": {
    name: "osv-scanner",
    install: [
      "  brew install osv-scanner                                              # macOS",
      "  go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest   # Go",
      "  https://google.github.io/osv-scanner/installation/",
    ].join("\n"),
  },
  gitleaks: {
    name: "gitleaks",
    install: [
      "  brew install gitleaks                                                 # macOS",
      "  go install github.com/gitleaks/gitleaks/v8@latest                     # Go",
      "  https://github.com/gitleaks/gitleaks#installing",
    ].join("\n"),
  },
};

function hasCommand(name: string): boolean {
  const r = spawnSync("command", ["-v", name], { shell: true });
  return r.status === 0;
}

function resolveUpstreamRange(): string {
  const r = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { encoding: "utf-8" },
  );
  const upstream = r.status === 0 ? r.stdout.trim() : "origin/main";
  return `${upstream}..HEAD`;
}

/** Returns true if tool is available, false if missing. Exits in hard mode. */
function requireTool(key: string): boolean {
  const tool = TOOLS[key];
  if (hasCommand(tool.name)) return true;

  if (softMode) {
    console.warn(`⚠️  ${tool.name} not installed, skipping (PEW_G2_SOFT=1)`);
    return false;
  }

  console.error(`❌ ${tool.name} is required but not installed.\n`);
  console.error(`Install ${tool.name} (v2+ required for bun.lock support):\n`);
  console.error(tool.install);
  console.error(
    `\nTo skip this check (not recommended), set PEW_G2_SOFT=1:\n  PEW_G2_SOFT=1 git push\n`,
  );
  return false;
}

let failed = false;
let hardMissing = false;

// osv-scanner
const hasOsv = requireTool("osv-scanner");
if (hasOsv) {
  console.log("🔍 osv-scanner: scanning bun.lock...");
  const r = spawnSync("osv-scanner", ["--lockfile=bun.lock"], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error("❌ osv-scanner found vulnerabilities.");
    failed = true;
  } else {
    console.log("✅ osv-scanner: clean");
  }
} else if (!softMode) {
  hardMissing = true;
}

// gitleaks
const hasGitleaks = requireTool("gitleaks");
if (hasGitleaks) {
  const range = resolveUpstreamRange();
  console.log(`🔍 gitleaks: scanning commits ${range}...`);
  const gitleaksArgs = ["git", `--log-opts=${range}`];
  // Use repo-level .gitleaks.toml if it exists (allowlists test files)
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = resolve(repoRoot, ".gitleaks.toml");
  if (existsSync(configPath)) {
    gitleaksArgs.push("--config", configPath);
  }
  const r = spawnSync("gitleaks", gitleaksArgs, {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error("❌ gitleaks found secrets in commits.");
    failed = true;
  } else {
    console.log("✅ gitleaks: clean");
  }
} else if (!softMode) {
  hardMissing = true;
}

if (hardMissing) {
  console.error("\n❌ G2 security gate FAILED: required tools missing.");
  process.exit(1);
}

if (failed) {
  console.error("\n❌ G2 security gate FAILED: vulnerabilities or secrets found.");
  process.exit(1);
}

console.log("\n✅ G2 security gate passed");
process.exit(0);

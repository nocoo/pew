import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hook = resolve(".husky/pre-push");

// Any `bun run` other than the security scan exits 99, so a passing hook also
// proves no other lane was launched: the E2E suites belong to CI now.
function runHook(failure: "none" | "test:security" | "preflight") {
  const root = mkdtempSync(join(tmpdir(), "pew-pre-push-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "bun"), `#!/bin/sh
if [ "$1" = "--no-env-file" ]; then
  echo "environment guard ran"
  [ "$FAILURE" != "preflight" ]
  exit $?
fi
[ "$1" = "run" ] || exit 99
[ "$2" = "test:security" ] || exit 99
echo "test:security stdout"
echo "test:security stderr" >&2
[ "$FAILURE" != "test:security" ]
`, { mode: 0o755 });
    return spawnSync("/bin/sh", ["-e", hook], {
      cwd: root,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, TMPDIR: root, FAILURE: failure },
      encoding: "utf8",
      timeout: 120_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("pre-push G2-only gate under Husky sh -e", () => {
  it("runs the security scan, prints its output, and passes when it is clean", () => {
    const result = runHook("none");
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("environment guard ran");
    expect(result.stdout).toContain("test:security stdout");
    expect(result.stdout).toContain("test:security stderr");
    expect(result.stdout).not.toContain("pre-push FAILED");
    expect(result.stdout).toContain("pre-push passed: G2 security (osv-scanner + gitleaks)");
  });

  it("rejects a failing security scan", () => {
    const result = runHook("test:security");
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain("test:security stdout");
    expect(result.stdout).toContain("pre-push FAILED: G2 security gate.");
    expect(result.stdout).not.toContain("pre-push passed:");
  });

  it("rejects an environment guard failure before launching any lane", () => {
    const result = runHook("preflight");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("environment guard ran\n");
  });
});
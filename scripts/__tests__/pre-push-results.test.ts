import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hook = resolve(".husky/pre-push");
const lanes = [
  ["test:e2e", "API E2E tests did not pass."],
  ["test:e2e:ui", "Browser E2E tests did not pass."],
  ["test:security", "G2 security gate."],
] as const;

function runHook(failure: string) {
  const root = mkdtempSync(join(tmpdir(), "pew-pre-push-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "bun"),
      `#!/bin/sh
if [ "$1" = "--no-env-file" ]; then
  echo "environment guard ran"
  [ "$FAILURE" != "preflight" ]
  exit $?
fi
[ "$1" = "run" ] || exit 99
case "$2" in
  test:e2e|test:e2e:ui|test:security) ;;
  *) exit 99 ;;
esac
echo "$2 stdout"
echo "$2 stderr" >&2
if [ "$FAILURE" = "$2" ] || [ "$FAILURE" = "all" ]; then exit 23; fi
`,
      { mode: 0o755 },
    );
    return spawnSync("/bin/sh", ["-e", hook], {
      cwd: root,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, TMPDIR: root, FAILURE: failure },
      encoding: "utf8",
      timeout: 5000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("pre-push result aggregation under Husky sh -e", () => {
  it.each(["none", ...lanes.map(([lane]) => lane), "all"])(
    "prints every lane and rejects failures (%s)",
    (failure) => {
      const result = runHook(failure);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(failure === "none" ? 0 : 1);
      expect(result.stdout).toContain("environment guard ran");
      for (const [lane, message] of lanes) {
        expect(result.stdout).toContain(`${lane} stdout`);
        expect(result.stdout).toContain(`${lane} stderr`);
        if (failure === lane || failure === "all") {
          expect(result.stdout).toContain(`pre-push FAILED: ${message}`);
        } else {
          expect(result.stdout).not.toContain(`pre-push FAILED: ${message}`);
        }
      }
      if (failure === "none") {
        expect(result.stdout).toContain("pre-push passed:");
      } else {
        expect(result.stdout).not.toContain("pre-push passed:");
      }
    },
  );

  it("rejects an environment guard failure before launching any lane", () => {
    const result = runHook("preflight");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("environment guard ran\n");
  });
});

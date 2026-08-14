import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  copyFullSwcHelpers,
  findSwcHelpersDirs,
  fixStandaloneSwcHelpers,
  versionFromHelpersPath,
} from "../fix-standalone-swc-helpers";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function writeHelpersPackage(
  bunDir: string,
  version: string,
  files: Record<string, string>,
): string {
  const helpers = join(
    bunDir,
    `@swc+helpers@${version}`,
    "node_modules",
    "@swc",
    "helpers",
  );
  mkdirSync(helpers, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = join(helpers, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return helpers;
}

describe("fix-standalone-swc-helpers", () => {
  it("finds @swc/helpers under bun isolated layout", () => {
    const root = tempDir("pew-swc-find-");
    const bun = join(root, "node_modules", ".bun");
    writeHelpersPackage(bun, "0.5.23", {
      "package.json": '{"name":"@swc/helpers"}',
      "esm/_interop_require_default.js": "export default x => x;",
    });

    const found = findSwcHelpersDirs(bun);
    expect(found).toHaveLength(1);
    expect(versionFromHelpersPath(found[0]!)).toBe("0.5.23");
  });

  it("copies full package over incomplete standalone NFT output", () => {
    const root = tempDir("pew-swc-copy-");
    const src = writeHelpersPackage(join(root, "src"), "0.5.23", {
      "package.json": '{"name":"@swc/helpers","version":"0.5.23"}',
      "cjs/_interop_require_default.cjs": "module.exports = x => x;",
      "esm/_interop_require_default.js": "export default x => x;",
    });
    const dest = writeHelpersPackage(join(root, "dest"), "0.5.23", {
      "package.json": '{"name":"@swc/helpers","version":"0.5.23"}',
      "cjs/_interop_require_default.cjs": "module.exports = x => x;",
    });

    expect(existsSync(join(dest, "esm", "_interop_require_default.js"))).toBe(
      false,
    );
    copyFullSwcHelpers(src, dest);
    expect(existsSync(join(dest, "esm", "_interop_require_default.js"))).toBe(
      true,
    );
  });

  it("patches monorepo-shaped standalone tree", () => {
    const root = tempDir("pew-swc-fix-");
    writeHelpersPackage(join(root, "node_modules", ".bun"), "0.5.23", {
      "package.json": "{}",
      "cjs/_interop_require_default.cjs": "module.exports = 1;",
      "esm/_interop_require_default.js": "export default 1;",
    });
    writeHelpersPackage(
      join(root, "packages", "web", ".next", "standalone", "node_modules", ".bun"),
      "0.5.23",
      {
        "package.json": "{}",
        "cjs/_interop_require_default.cjs": "module.exports = 1;",
      },
    );

    const result = fixStandaloneSwcHelpers({ rootDir: root, required: true });
    expect(result.skipped).toBe(false);
    expect(result.fixed).toHaveLength(1);
    expect(
      existsSync(join(result.fixed[0]!, "esm", "_interop_require_default.js")),
    ).toBe(true);
  });

  it("soft-skips when standalone is absent", () => {
    const root = tempDir("pew-swc-skip-");
    mkdirSync(join(root, "node_modules", ".bun"), { recursive: true });
    const result = fixStandaloneSwcHelpers({ rootDir: root });
    expect(result.skipped).toBe(true);
  });
});

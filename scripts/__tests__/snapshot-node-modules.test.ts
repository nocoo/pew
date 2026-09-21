import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "snapshot-node-modules.sh",
);

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// Mirrors bun workspaces: scope containers are real directories holding
// relative symlinks that must rebind to the snapshot's own packages, while
// regular packages and .bin are read-only reuse of the installed tree.
function buildFixture(root: string): { repo: string; snap: string } {
  const repo = join(root, "repo");
  const snap = join(root, "snap");
  write(join(repo, "node_modules", "vitest", "package.json"), '{"name":"vitest"}');
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  symlinkSync("../vitest/package.json", join(repo, "node_modules", ".bin", "vitest"));
  for (const cache of [".cache", ".vite", ".vitest"]) {
    write(join(repo, "node_modules", cache, "marker"), "x");
  }
  mkdirSync(join(repo, "node_modules", "@pew"), { recursive: true });
  symlinkSync("../../packages/core", join(repo, "node_modules", "@pew", "core"));
  write(join(repo, "packages", "core", "package.json"), '{"name":"@pew/core"}');
  mkdirSync(join(repo, "packages", "web", "node_modules", "@pew"), {
    recursive: true,
  });
  symlinkSync("../../../core", join(repo, "packages", "web", "node_modules", "@pew", "core"));
  write(join(snap, "packages", "core", "package.json"), '{"name":"@pew/core"}');
  mkdirSync(join(snap, "packages", "web"), { recursive: true });
  return { repo, snap };
}

describe("snapshot-node-modules.sh", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `pew-snap-nm-${process.pid}-${Date.now()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("rebinds scoped workspace symlinks to the snapshot's own packages", () => {
    const { repo, snap } = buildFixture(root);
    const r = spawnSync("sh", [SCRIPT, repo, snap], { encoding: "utf-8" });
    expect(r.status).toBe(0);

    const scope = join(snap, "node_modules", "@pew");
    expect(lstatSync(scope).isDirectory()).toBe(true);
    expect(realpathSync(join(scope, "core"))).toBe(
      realpathSync(join(snap, "packages", "core")),
    );
    expect(realpathSync(join(snap, "packages", "web", "node_modules", "@pew", "core"))).toBe(
      realpathSync(join(snap, "packages", "core")),
    );

    // Real packages and .bin are reused read-only from the installed tree.
    expect(realpathSync(join(snap, "node_modules", "vitest"))).toBe(
      realpathSync(join(repo, "node_modules", "vitest")),
    );
    expect(realpathSync(join(snap, "node_modules", ".bin"))).toBe(
      realpathSync(join(repo, "node_modules", ".bin")),
    );

    // Runner caches stay snapshot-local at every level — never linked into
    // the worktree.
    for (const cache of [".cache", ".vite", ".vitest"]) {
      expect(readdirSync(join(snap, "node_modules"))).not.toContain(cache);
    }
  });

  it("fails closed when arguments are missing", () => {
    const r = spawnSync("sh", [SCRIPT], { encoding: "utf-8" });
    expect(r.status).toBe(1);
  });

  it("keeps staged package content authoritative over linked dependencies", () => {
    const { repo, snap } = buildFixture(root);
    const r = spawnSync("sh", [SCRIPT, repo, snap], { encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(
      readFileSync(join(snap, "packages", "core", "package.json"), "utf-8"),
    ).toContain("@pew/core");
  });
});

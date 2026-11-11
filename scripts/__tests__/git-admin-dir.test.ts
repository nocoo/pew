import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGitInfoDir } from "../git-admin-dir";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pew-git-info-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveGitInfoDir", () => {
  it("uses .git/info when .git is a real directory", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".git"));
    expect(resolveGitInfoDir(root)).toBe(join(root, ".git/info"));
  });

  it("follows the gitdir pointer when .git is a worktree marker file", () => {
    // A linked worktree stores `.git` as a file containing `gitdir: <path>`;
    // `<root>/.git/info` is then not a directory at all.
    const root = makeRoot();
    const admin = join(makeRoot(), "worktrees", "lane");
    mkdirSync(admin, { recursive: true });
    writeFileSync(join(root, ".git"), `gitdir: ${admin}\n`);
    expect(resolveGitInfoDir(root)).toBe(join(admin, "info"));
  });

  it("resolves a relative gitdir pointer against the repository root", () => {
    const root = makeRoot();
    mkdirSync(join(root, "admin"));
    writeFileSync(join(root, ".git"), "gitdir: admin\n");
    expect(resolveGitInfoDir(root)).toBe(join(root, "admin/info"));
  });

  it("falls back to .git/info when the marker is absent or unreadable as a pointer", () => {
    const root = makeRoot();
    expect(resolveGitInfoDir(root)).toBe(join(root, ".git/info"));
    writeFileSync(join(root, ".git"), "not a pointer\n");
    expect(resolveGitInfoDir(root)).toBe(join(root, ".git/info"));
  });
});
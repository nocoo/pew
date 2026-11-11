import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Resolve the git admin directory's `info` folder for a given repo root.
 *
 * In a normal checkout `.git` is a directory, so the admin dir is `<root>/.git`.
 * In a git worktree `.git` is a FILE containing `gitdir: <path>`, so the real
 * admin dir lives elsewhere (e.g. `<main>/.git/worktrees/<name>`). Writing to
 * `<root>/.git/info` there fails with ENOTDIR — callers that swallow cache
 * errors then silently lose their cache on every worktree.
 *
 * This helper reads the `gitdir` pointer when present and returns
 * `<adminDir>/info` in both cases. Falls back to `<root>/.git/info` when `.git`
 * is absent or unreadable, preserving the historical (best-effort) behavior.
 */
export function resolveGitInfoDir(root: string): string {
  const dotGit = join(root, ".git");
  try {
    const marker = readFileSync(dotGit, "utf8");
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(marker);
    if (match) {
      const target = match[1];
      const adminDir = isAbsolute(target) ? target : resolve(root, target);
      return join(adminDir, "info");
    }
  } catch {
    // `.git` is a directory (ENOTDIR/EISDIR) or missing — use the default.
  }
  return join(dotGit, "info");
}

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively collect files matching a predicate under a directory.
 * Uses withFileTypes to avoid separate stat() calls per entry.
 * Returns absolute paths sorted alphabetically.
 *
 * A directory that cannot be read is skipped rather than thrown, so one
 * unreadable subtree never fails a whole sync. Callers that need to know the
 * listing is partial (rather than genuinely empty) pass `onWalkError`.
 */
async function collectFiles(
  dir: string,
  predicate: (name: string) => boolean,
  onWalkError?: () => void,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      onWalkError?.();
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results.sort();
}

/**
 * Discover Claude Code JSONL files.
 * Path pattern: ~/.claude/projects/\*\*\/*.jsonl
 */
export async function discoverClaudeFiles(
  claudeDir: string,
): Promise<string[]> {
  const projectsDir = join(claudeDir, "projects");
  return collectFiles(projectsDir, (name) => name.endsWith(".jsonl"));
}

/**
 * Result of OpenCode discovery with directory-level mtime tracking.
 */
export interface OpenCodeDiscoveryResult {
  /** Files in changed directories (only these need parsing) */
  files: string[];
  /** Updated directory mtimes (all directories, for persisting) */
  dirMtimes: Record<string, number>;
  /** Number of directories skipped due to unchanged mtime */
  skippedDirs: number;
  /**
   * Absolute paths of session directories the driver chose NOT to read
   * this run because their mtime was unchanged since the last sync.
   * Cursors for files under any of these paths are still valid even
   * though their files are absent from `files`. The orchestrator uses
   * this set to keep cursor-prune away from the mtime-skip fast path
   * (otherwise every empty sync would stat() every existing message
   * file just to confirm it still exists).
   */
  skippedDirPaths: string[];
}

/**
 * Discover OpenCode message files with directory-level mtime optimization.
 *
 * Instead of stat()-ing all 66K+ message files, we stat() only the ~3K
 * session directories. If a directory's mtime hasn't changed since last
 * sync, we skip the entire directory (no readdir, no file stat).
 *
 * Path pattern: ~/.local/share/opencode/storage/message/ses_*\/msg_*.json
 */
export async function discoverOpenCodeFiles(
  messageDir: string,
  knownDirMtimes?: Record<string, number>,
): Promise<OpenCodeDiscoveryResult> {
  const known = knownDirMtimes ?? {};
  const newDirMtimes: Record<string, number> = {};
  const files: string[] = [];
  const skippedDirPaths: string[] = [];
  let skippedDirs = 0;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(messageDir, { withFileTypes: true });
  } catch {
    return { files: [], dirMtimes: {}, skippedDirs: 0, skippedDirPaths: [] };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = join(messageDir, entry.name);
    let dirStat: import("node:fs").Stats;
    try {
      dirStat = await stat(dirPath);
    } catch {
      continue;
    }

    const currentMtime = dirStat.mtimeMs;
    newDirMtimes[dirPath] = currentMtime;

    // Skip directory if mtime unchanged
    if (known[dirPath] === currentMtime) {
      skippedDirs++;
      skippedDirPaths.push(dirPath);
      continue;
    }

    // Directory changed — read its files
    let dirEntries: import("node:fs").Dirent[];
    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEntry of dirEntries) {
      if (fileEntry.isFile() && fileEntry.name.endsWith(".json")) {
        files.push(join(dirPath, fileEntry.name));
      }
    }
  }

  return { files: files.sort(), dirMtimes: newDirMtimes, skippedDirs, skippedDirPaths };
}

/**
 * Discover OpenClaw session files.
 * Path pattern: ~/.openclaw/agents/\*\/sessions/*.jsonl
 */
export async function discoverOpenClawFiles(
  openclawDir: string,
): Promise<string[]> {
  const agentsDir = join(openclawDir, "agents");
  return collectFiles(agentsDir, (name) => name.endsWith(".jsonl"));
}

/**
 * Discover pi session JSONL files.
 * Path pattern: ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
 */
export async function discoverPiFiles(
  piSessionsDir: string,
): Promise<string[]> {
  return collectFiles(piSessionsDir, (name) => name.endsWith(".jsonl"));
}

/** Codex rollout listing plus whether the traversal saw every directory. */
export interface CodexDiscovery {
  files: string[];
  /**
   * False when any directory under the scanned roots could not be read
   * (permissions, an unmounted volume, a transient I/O error). The listing is
   * then a subset of reality, which callers must not mistake for "this history
   * no longer exists".
   */
  complete: boolean;
}

/**
 * Discover Codex CLI rollout files.
 * Path pattern: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * @param codexSessionsDir Primary Codex sessions directory (~/.codex/sessions)
 * @param extraDirs Additional directories to scan (e.g. Multica codex-home/sessions/)
 */
export async function discoverCodexFiles(
  codexSessionsDir: string,
  extraDirs?: string[],
): Promise<CodexDiscovery> {
  const predicate = (name: string) =>
    name.startsWith("rollout-") && name.endsWith(".jsonl");

  const results: string[] = [];
  let complete = true;
  const onWalkError = () => {
    complete = false;
  };

  // Primary directory
  const primaryFiles = await collectFiles(codexSessionsDir, predicate, onWalkError);
  results.push(...primaryFiles);

  // Extra directories (e.g. Multica Codex sessions)
  if (extraDirs && extraDirs.length > 0) {
    for (const extraDir of extraDirs) {
      const extraFiles = await collectFiles(extraDir, predicate, onWalkError);
      results.push(...extraFiles);
    }
  }

  // Deduplicate by inode — Multica codex-home/sessions/ dirs are often
  // symlinks to ~/.codex/sessions/, producing hardlinked files that would
  // otherwise be counted N times (once per Multica run directory).
  const seenInodes = new Set<string>();
  const deduped: string[] = [];
  for (const filePath of results) {
    try {
      const st = await stat(filePath);
      const key = `${st.dev}:${st.ino}`;
      if (seenInodes.has(key)) continue;
      seenInodes.add(key);
      deduped.push(filePath);
    } catch {
      // If stat fails, keep the file (let downstream handle errors)
      deduped.push(filePath);
    }
  }

  return { files: deduped.sort(), complete };
}

/**
 * Discover GitHub Copilot CLI process log files.
 * Path pattern: ~/.copilot/logs/process-*.log
 */
export async function discoverCopilotCliFiles(
  logsDir: string,
): Promise<string[]> {
  return collectFiles(logsDir, (name) =>
    name.startsWith("process-") && name.endsWith(".log"),
  );
}

/**
 * Discover Copilot OTel JSONL file exports from explicit files/directories.
 * Directory entries are scanned recursively so CI runners may point pew at a
 * stable artifact root containing one telemetry file per task.
 */
export async function discoverCopilotOtelFiles(paths: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const path of paths) {
    try {
      const st = await stat(path);
      if (st.isFile()) {
        files.add(path);
      } else if (st.isDirectory()) {
        for (const file of await collectFiles(path, (name) => name.endsWith(".jsonl"))) {
          files.add(file);
        }
      }
    } catch {
      // Missing exporter paths are expected when Copilot has not run yet.
    }
  }
  return [...files].sort();
}

/**
 * Discover Grok CLI unified log file.
 * Path: ~/.grok/logs/unified.jsonl (single append-only file).
 * Returns [path] if the file exists, else [].
 */
export async function discoverGrokLogFile(
  logsPath: string,
): Promise<string[]> {
  try {
    const st = await stat(logsPath);
    if (st.isFile()) return [logsPath];
  } catch {
    // missing
  }
  return [];
}

/**
 * Discover Grok CLI session summary files.
 * Path pattern: ~/.grok/sessions/<enc-cwd>/<sid>/summary.json
 */
export async function discoverGrokSessionDirs(
  sessionsDir: string,
): Promise<string[]> {
  return collectFiles(sessionsDir, (name) => name === "summary.json");
}

/**
 * Discover WorkBuddy session JSONL files across one or more data roots.
 *
 * Path pattern: `<root>/projects/<slug>/<sessionId>.jsonl`. The domestic build
 * installs at `~/.workbuddy`; the international build at `~/.workbuddy-ai`
 * (product name `workbuddy-ai`). Both keep the same layout. Only depth-2 files
 * are sessions — deeper entries (subagent transcripts at
 * `<slug>/subagents/agent-*.jsonl` and tool outputs under `<sessionId>/`) are
 * auxiliary and deliberately excluded.
 *
 * Files are deduplicated by inode (`dev:ino`), so a root reached twice through
 * a symlink alias yields each file once and the token driver cannot parse and
 * count it twice. The merged list is globally sorted, and a missing root
 * contributes nothing.
 */
export async function discoverWorkbuddyFilesFromRoots(
  roots: string[],
): Promise<string[]> {
  const results: string[] = [];
  const seenInodes = new Set<string>();
  for (const root of roots) {
    const projectsDir = join(root, "projects");
    let slugs: import("node:fs").Dirent[];
    try {
      slugs = await readdir(projectsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const slug of slugs) {
      if (!slug.isDirectory()) continue;
      const slugDir = join(projectsDir, slug.name);
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(slugDir, { withFileTypes: true });
      } catch {
        // An unreadable project directory never fails the whole scan.
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const filePath = join(slugDir, entry.name);
        // Dedupe by inode: two configured roots (or a symlinked root) can
        // resolve to the same file under different path strings.
        try {
          const st = await stat(filePath);
          const key = `${st.dev}:${st.ino}`;
          if (seenInodes.has(key)) continue;
          seenInodes.add(key);
        } catch {
          // stat failure: keep the file and let downstream handle it
        }
        results.push(filePath);
      }
    }
  }
  return results.sort();
}

/** Discover WorkBuddy session JSONL files under a single data root. */
export async function discoverWorkbuddyFiles(
  workbuddyDir: string,
): Promise<string[]> {
  return discoverWorkbuddyFilesFromRoots([workbuddyDir]);
}

/** Accounting reads turn updates, including sessions without a summary file. */
export async function discoverGrokUsageFiles(sessionsDir: string): Promise<string[]> {
  return collectFiles(sessionsDir, (name) => name === "updates.jsonl");
}

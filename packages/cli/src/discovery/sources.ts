import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively collect files matching a predicate under a directory.
 * Uses withFileTypes to avoid separate stat() calls per entry.
 * Returns absolute paths sorted alphabetically.
 */
async function collectFiles(
  dir: string,
  predicate: (name: string) => boolean,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
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
 * Discover Gemini CLI session files.
 * Path pattern: ~/.gemini/tmp/\*\/chats/session-*.json
 */
export async function discoverGeminiFiles(
  geminiDir: string,
): Promise<string[]> {
  const tmpDir = join(geminiDir, "tmp");
  return collectFiles(tmpDir, (name) =>
    name.startsWith("session-") && name.endsWith(".json"),
  );
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
  let skippedDirs = 0;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(messageDir, { withFileTypes: true });
  } catch {
    return { files: [], dirMtimes: {}, skippedDirs: 0 };
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

  return { files: files.sort(), dirMtimes: newDirMtimes, skippedDirs };
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
): Promise<string[]> {
  const predicate = (name: string) =>
    name.startsWith("rollout-") && name.endsWith(".jsonl");

  const results: string[] = [];

  // Primary directory
  const primaryFiles = await collectFiles(codexSessionsDir, predicate);
  results.push(...primaryFiles);

  // Extra directories (e.g. Multica Codex sessions)
  if (extraDirs && extraDirs.length > 0) {
    for (const extraDir of extraDirs) {
      const extraFiles = await collectFiles(extraDir, predicate);
      results.push(...extraFiles);
    }
  }

  return results.sort();
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
 * Discover Kosmos chat session JSON files.
 *
 * Scans multiple data directories (kosmos-app + pm-studio-app) for
 * files matching the pattern `chatSession_*.json`.
 *
 * @param dataDirs Array of Kosmos data directories (platform-specific)
 */
export async function discoverKosmosFiles(
  dataDirs: string[],
): Promise<string[]> {
  const results: string[] = [];

  for (const dataDir of dataDirs) {
    const found = await collectFiles(dataDir, (name) =>
      name.startsWith("chatSession_") && name.endsWith(".json"),
    );
    results.push(...found);
  }

  return results.sort();
}

/**
 * Discover VSCode Copilot Chat session JSONL files.
 *
 * Scans multiple base directories (stable + insiders), each containing:
 *   - workspaceStorage/\<hash\>/chatSessions/\<uuid\>.jsonl (per-workspace)
 *   - globalStorage/emptyWindowChatSessions/\<uuid\>.jsonl  (window-less)
 *
 * @param baseDirs Array of VSCode User directories
 *                 (e.g. ["~/Library/Application Support/Code/User/",
 *                        "~/Library/Application Support/Code - Insiders/User/"])
 */
export async function discoverVscodeCopilotFiles(
  baseDirs: string[],
): Promise<string[]> {
  const results: string[] = [];

  for (const baseDir of baseDirs) {
    // 1. globalStorage/emptyWindowChatSessions/*.jsonl + *.json
    const globalChatDir = join(baseDir, "globalStorage", "emptyWindowChatSessions");
    let globalEntries: import("node:fs").Dirent[];
    try {
      globalEntries = await readdir(globalChatDir, { withFileTypes: true });
    } catch {
      globalEntries = [];
    }
    for (const entry of globalEntries) {
      if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json"))) {
        results.push(join(globalChatDir, entry.name));
      }
    }

    // 2. workspaceStorage/*/chatSessions/*.jsonl
    const workspaceStorageDir = join(baseDir, "workspaceStorage");
    let workspaceDirs: import("node:fs").Dirent[];
    try {
      workspaceDirs = await readdir(workspaceStorageDir, { withFileTypes: true });
    } catch {
      workspaceDirs = [];
    }
    for (const wsEntry of workspaceDirs) {
      if (!wsEntry.isDirectory()) continue;

      const chatSessionsDir = join(workspaceStorageDir, wsEntry.name, "chatSessions");
      let chatEntries: import("node:fs").Dirent[];
      try {
        chatEntries = await readdir(chatSessionsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const chatEntry of chatEntries) {
        if (chatEntry.isFile() && (chatEntry.name.endsWith(".jsonl") || chatEntry.name.endsWith(".json"))) {
          results.push(join(chatSessionsDir, chatEntry.name));
        }
      }
    }
  }

  return results.sort();
}

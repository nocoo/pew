import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively collect files matching a predicate under a directory.
 * Returns absolute paths sorted alphabetically.
 */
async function collectFiles(
  dir: string,
  predicate: (name: string) => boolean,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const st = await stat(fullPath).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        await walk(fullPath);
      } else if (st.isFile() && predicate(entry)) {
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
 * Discover OpenCode message files.
 * Path pattern: ~/.local/share/opencode/storage/message/ses_*\/msg_*.json
 */
export async function discoverOpenCodeFiles(
  messageDir: string,
): Promise<string[]> {
  return collectFiles(messageDir, (name) => name.endsWith(".json"));
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

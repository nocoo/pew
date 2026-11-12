import { homedir } from "node:os";
import { readdirSync, existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Discover Multica Codex session directories.
 *
 * Multica spawns Codex CLI with a per-task CODEX_HOME env var pointing to
 * ~/multica_workspaces/<workspace-id>/<task-id>/codex-home/. Codex writes
 * its standard rollout JSONL files to codex-home/sessions/.
 *
 * This function discovers all such session directories under the Multica
 * workspaces root (default: ~/multica_workspaces, override via $MULTICA_WORKSPACES).
 *
 * Returns an array of absolute paths to existing sessions/ directories.
 */
function discoverMulticaCodexDirs(home: string): string[] {
  const multicaRoot = process.env.MULTICA_WORKSPACES || join(home, "multica_workspaces");

  if (!existsSync(multicaRoot)) {
    return [];
  }

  try {
    const st = statSync(multicaRoot);
    if (!st.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const results: string[] = [];

  try {
    // ~/multica_workspaces/<workspace-id>/
    const workspaces = readdirSync(multicaRoot);
    for (const workspace of workspaces) {
      const workspacePath = join(multicaRoot, workspace);
      try {
        if (!statSync(workspacePath).isDirectory()) continue;

        // ~/multica_workspaces/<workspace-id>/<task-id>/
        const tasks = readdirSync(workspacePath);
        for (const task of tasks) {
          const taskPath = join(workspacePath, task);
          try {
            if (!statSync(taskPath).isDirectory()) continue;

            // ~/multica_workspaces/<workspace-id>/<task-id>/codex-home/sessions/
            const sessionsPath = join(taskPath, "codex-home", "sessions");
            if (existsSync(sessionsPath) && statSync(sessionsPath).isDirectory()) {
              results.push(sessionsPath);
            }
          } catch {
            // Skip inaccessible task directories
          }
        }
      } catch {
        // Skip inaccessible workspace directories
      }
    }
  } catch {
    // Root unreadable
  }

  return results;
}

/**
 * Discover Hermes profile databases at ~/.hermes/profiles/<name>/state.db.
 *
 * Returns an array of { dbPath, dbKey } objects:
 *   - dbPath: absolute path to the state.db file
 *   - dbKey: profile identifier (e.g. "profiles/tomato")
 *
 * Only returns profiles that have an existing state.db file.
 */
function discoverHermesProfileDbs(hermesHome: string): Array<{ dbPath: string; dbKey: string }> {
  const profilesDir = join(hermesHome, "profiles");
  if (!existsSync(profilesDir)) {
    return [];
  }

  try {
    const st = statSync(profilesDir);
    if (!st.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const results: Array<{ dbPath: string; dbKey: string }> = [];
  try {
    const entries = readdirSync(profilesDir);
    for (const name of entries) {
      const profileDir = join(profilesDir, name);
      try {
        const profileStat = statSync(profileDir);
        if (!profileStat.isDirectory()) continue;

        const dbPath = join(profileDir, "state.db");
        if (existsSync(dbPath)) {
          results.push({ dbPath, dbKey: `profiles/${name}` });
        }
      } catch {
        // Skip inaccessible profile directories
      }
    }
  } catch {
    // profiles dir unreadable
  }

  return results;
}

/**
 * Resolve default paths for pew state and AI tool data.
 * All paths can be overridden for testing.
 */
export function resolveDefaultPaths(home = homedir()) {
  const codexHome = process.env.CODEX_HOME || join(home, ".codex");
  // Always use ~/.hermes as the Hermes root - ignore HERMES_HOME which points to
  // a profile-specific directory (e.g. ~/.hermes/profiles/tomato), not the root.
  const hermesHome = join(home, ".hermes");
  const copilotCliOtelPaths = [
    process.env.COPILOT_OTEL_FILE_EXPORTER_PATH,
    ...(process.env.PEW_COPILOT_OTEL_PATHS?.split(delimiter) ?? []),
  ].filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    .map((path) => path.trim());
  return {
    /** pew state directory: ~/.config/pew/ */
    stateDir: join(home, ".config", "pew"),
    /** pew bin directory: ~/.config/pew/bin/ */
    binDir: join(home, ".config", "pew", "bin"),
    /** notify.cjs path: ~/.config/pew/bin/notify.cjs */
    notifyPath: join(home, ".config", "pew", "bin", "notify.cjs"),
    /** Claude Code data: ~/.claude */
    claudeDir: join(home, ".claude"),
    /** Codex CLI sessions: ~/.codex/sessions (or $CODEX_HOME/sessions) */
    codexSessionsDir: join(codexHome, "sessions"),
    /** Antigravity CLI conversation databases */
    antigravityDir: join(home, ".gemini", "antigravity-cli", "conversations"),
    /** OpenCode message storage: ~/.local/share/opencode/storage/message */
    openCodeMessageDir: join(
      home,
      ".local",
      "share",
      "opencode",
      "storage",
      "message",
    ),
    /** OpenCode SQLite database: ~/.local/share/opencode/opencode.db */
    openCodeDbPath: join(home, ".local", "share", "opencode", "opencode.db"),
    /** OpenClaw data: ~/.openclaw */
    openclawDir: join(home, ".openclaw"),
    /** Grok CLI home: ~/.grok */
    grokHome: join(home, ".grok"),
    /** Grok CLI unified log: ~/.grok/logs/unified.jsonl */
    grokLogsPath: join(home, ".grok", "logs", "unified.jsonl"),
    /** Grok CLI sessions root: ~/.grok/sessions */
    grokSessionsDir: join(home, ".grok", "sessions"),
    /** WorkBuddy data roots: domestic `~/.workbuddy` + international `~/.workbuddy-ai` */
    workbuddyDirs: [join(home, ".workbuddy"), join(home, ".workbuddy-ai")],
    /** Pi session data: ~/.pi/agent/sessions */
    piSessionsDir: join(home, ".pi", "agent", "sessions"),

    /** GitHub Copilot CLI logs: ~/.copilot/logs */
    copilotCliLogsDir: join(home, ".copilot", "logs"),
    /** Copilot OTel files/roots from standard and pew-specific env vars */
    copilotCliOtelPaths: [...new Set(copilotCliOtelPaths)],
    /** Hermes Agent database: ~/.hermes/state.db */
    hermesDbPath: join(hermesHome, "state.db"),
    /** Hermes Agent profile databases: ~/.hermes/profiles/<name>/state.db */
    hermesProfileDbPaths: discoverHermesProfileDbs(hermesHome),

    /** Multica Codex session directories: ~/multica_workspaces/<ws>/<task>/codex-home/sessions/ */
    multicaCodexDirs: discoverMulticaCodexDirs(home),
  };
}

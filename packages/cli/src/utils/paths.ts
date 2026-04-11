import { homedir } from "node:os";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

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
 * Resolve the platform-specific VSCode Copilot base directories.
 *
 * Returns an array of base dirs for both stable and Insiders builds:
 *   macOS:   ~/Library/Application Support/Code/User
 *            ~/Library/Application Support/Code - Insiders/User
 *   Linux:   ~/.config/Code/User
 *            ~/.config/Code - Insiders/User
 *   Windows: %APPDATA%/Code/User
 *            %APPDATA%/Code - Insiders/User
 */
function resolveVscodeCopilotDirs(home: string): string[] {
  const platform = process.platform;

  if (platform === "darwin") {
    const base = join(home, "Library", "Application Support");
    return [
      join(base, "Code", "User"),
      join(base, "Code - Insiders", "User"),
    ];
  }

  if (platform === "win32") {
    const appdata = process.env.APPDATA || join(home, "AppData", "Roaming");
    return [
      join(appdata, "Code", "User"),
      join(appdata, "Code - Insiders", "User"),
    ];
  }

  // Linux and other Unix
  return [
    join(home, ".config", "Code", "User"),
    join(home, ".config", "Code - Insiders", "User"),
  ];
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
    /** Gemini CLI data: ~/.gemini */
    geminiDir: join(home, ".gemini"),
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
    /** Pi session data: ~/.pi/agent/sessions */
    piSessionsDir: join(home, ".pi", "agent", "sessions"),
    /** VSCode Copilot base dirs (stable + insiders, platform-aware) */
    vscodeCopilotDirs: resolveVscodeCopilotDirs(home),
    /** GitHub Copilot CLI logs: ~/.copilot/logs */
    copilotCliLogsDir: join(home, ".copilot", "logs"),
    /** Hermes Agent database: ~/.hermes/state.db */
    hermesDbPath: join(hermesHome, "state.db"),
    /** Hermes Agent profile databases: ~/.hermes/profiles/<name>/state.db */
    hermesProfileDbPaths: discoverHermesProfileDbs(hermesHome),
    /** Kosmos data directory (kosmos-app, platform-aware) */
    kosmosDataDir: (() => {
      const platform = process.platform;
      if (platform === "darwin") return join(home, "Library", "Application Support", "kosmos-app");
      if (platform === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "kosmos-app");
      return join(home, ".config", "kosmos-app");
    })(),
    /** PM Studio data directory (pm-studio-app, platform-aware) */
    pmstudioDataDir: (() => {
      const platform = process.platform;
      if (platform === "darwin") return join(home, "Library", "Application Support", "pm-studio-app");
      if (platform === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "pm-studio-app");
      return join(home, ".config", "pm-studio-app");
    })(),
    /** Multica Codex session directories: ~/multica_workspaces/<ws>/<task>/codex-home/sessions/ */
    multicaCodexDirs: discoverMulticaCodexDirs(home),
  };
}

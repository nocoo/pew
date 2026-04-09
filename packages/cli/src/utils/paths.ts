import { homedir } from "node:os";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

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
 * Resolve the platform-specific Kosmos data directories.
 *
 * Returns an array of base dirs for both kosmos-app and pm-studio-app:
 *   macOS:   ~/Library/Application Support/kosmos-app
 *            ~/Library/Application Support/pm-studio-app
 *   Linux:   ~/.config/kosmos-app
 *            ~/.config/pm-studio-app
 *   Windows: %APPDATA%/kosmos-app
 *            %APPDATA%/pm-studio-app
 */
function resolveKosmosDataDirs(home: string): string[] {
  const platform = process.platform;

  if (platform === "darwin") {
    const base = join(home, "Library", "Application Support");
    return [
      join(base, "kosmos-app"),
      join(base, "pm-studio-app"),
    ];
  }

  if (platform === "win32") {
    const appdata = process.env.APPDATA || join(home, "AppData", "Roaming");
    return [
      join(appdata, "kosmos-app"),
      join(appdata, "pm-studio-app"),
    ];
  }

  // Linux and other Unix
  return [
    join(home, ".config", "kosmos-app"),
    join(home, ".config", "pm-studio-app"),
  ];
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
  const hermesHome = process.env.HERMES_HOME || join(home, ".hermes");
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
    /** Hermes Agent database: ~/.hermes/state.db (or $HERMES_HOME/state.db) */
    hermesDbPath: join(hermesHome, "state.db"),
    /** Hermes Agent profile databases: ~/.hermes/profiles/<name>/state.db */
    hermesProfileDbPaths: discoverHermesProfileDbs(hermesHome),
    /** Kosmos data directories (kosmos-app + pm-studio-app, platform-aware) */
    kosmosDataDirs: resolveKosmosDataDirs(home),
  };
}

import { homedir } from "node:os";
import { join } from "node:path";

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
    /** VSCode Copilot base dirs (stable + insiders, platform-aware) */
    vscodeCopilotDirs: resolveVscodeCopilotDirs(home),
  };
}

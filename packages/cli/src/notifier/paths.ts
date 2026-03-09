import { join, resolve } from "node:path";

export interface NotifierPaths {
  stateDir: string;
  binDir: string;
  notifyPath: string;
  lockPath: string;
  signalPath: string;
  claudeDir: string;
  claudeSettingsPath: string;
  geminiDir: string;
  geminiSettingsPath: string;
  opencodeConfigDir: string;
  opencodePluginDir: string;
  openclawHome: string;
  openclawConfigPath: string;
  openclawPluginDir: string;
  codexHome: string;
  codexConfigPath: string;
  codexNotifyOriginalPath: string;
}

function normalizeEnvPath(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? resolve(trimmed) : null;
}

export function resolveNotifierPaths(
  home: string,
  env: Record<string, string | undefined> = process.env,
): NotifierPaths {
  const stateDir = join(home, ".config", "pew");
  const binDir = join(stateDir, "bin");
  const claudeDir = join(home, ".claude");
  const geminiDir = normalizeEnvPath(env.GEMINI_HOME) ?? join(home, ".gemini");

  const opencodeConfigDir =
    normalizeEnvPath(env.OPENCODE_CONFIG_DIR) ??
    join(normalizeEnvPath(env.XDG_CONFIG_HOME) ?? join(home, ".config"), "opencode");

  const openclawHome =
    normalizeEnvPath(env.OPENCLAW_STATE_DIR) ?? join(home, ".openclaw");

  const codexHome = normalizeEnvPath(env.CODEX_HOME) ?? join(home, ".codex");

  return {
    stateDir,
    binDir,
    notifyPath: join(binDir, "notify.cjs"),
    lockPath: join(stateDir, "sync.lock"),
    signalPath: join(stateDir, "notify.signal"),
    claudeDir,
    claudeSettingsPath: join(claudeDir, "settings.json"),
    geminiDir,
    geminiSettingsPath: join(geminiDir, "settings.json"),
    opencodeConfigDir,
    opencodePluginDir: join(opencodeConfigDir, "plugin"),
    openclawHome,
    openclawConfigPath:
      normalizeEnvPath(env.OPENCLAW_CONFIG_PATH) ??
      join(openclawHome, "openclaw.json"),
    openclawPluginDir: join(stateDir, "openclaw-plugin"),
    codexHome,
    codexConfigPath: join(codexHome, "config.toml"),
    codexNotifyOriginalPath: join(stateDir, "codex_notify_original.json"),
  };
}

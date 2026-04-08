import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolveNotifierPaths } from "../notifier/paths.js";

describe("resolveNotifierPaths", () => {
  it("should use default paths when no env overrides are set", () => {
    const paths = resolveNotifierPaths("/home/tester", {});

    expect(paths.stateDir).toBe(join("/home/tester", ".config", "pew"));
    expect(paths.binDir).toBe(join("/home/tester", ".config", "pew", "bin"));
    expect(paths.notifyPath).toBe(
      join("/home/tester", ".config", "pew", "bin", "notify.cjs"),
    );
    expect(paths.lockPath).toBe(join("/home/tester", ".config", "pew", "sync.lock"));
    expect(paths.signalPath).toBe(
      join("/home/tester", ".config", "pew", "notify.signal"),
    );
    expect(paths.claudeSettingsPath).toBe(join("/home/tester", ".claude", "settings.json"));
    expect(paths.geminiSettingsPath).toBe(join("/home/tester", ".gemini", "settings.json"));
    expect(paths.opencodeConfigDir).toBe(join("/home/tester", ".config", "opencode"));
    expect(paths.opencodePluginDir).toBe(
      join("/home/tester", ".config", "opencode", "plugin"),
    );
    expect(paths.openclawHome).toBe(join("/home/tester", ".openclaw"));
    expect(paths.openclawConfigPath).toBe(
      join("/home/tester", ".openclaw", "openclaw.json"),
    );
    expect(paths.openclawPluginDir).toBe(
      join("/home/tester", ".config", "pew", "openclaw-plugin"),
    );
    expect(paths.codexHome).toBe(join("/home/tester", ".codex"));
    expect(paths.codexConfigPath).toBe(join("/home/tester", ".codex", "config.toml"));
    expect(paths.codexNotifyOriginalPath).toBe(
      join("/home/tester", ".config", "pew", "codex_notify_original.json"),
    );
    expect(paths.hermesHome).toBe(join("/home/tester", ".hermes"));
    expect(paths.hermesPluginDir).toBe(join("/home/tester", ".hermes", "plugins"));
  });

  it("should ignore whitespace-only env values and use defaults", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      GEMINI_HOME: "   ",
      OPENCODE_CONFIG_DIR: "  \t  ",
      CODEX_HOME: "",
    });

    // All should fall back to defaults since env values are whitespace-only
    expect(paths.geminiDir).toBe(join("/home/tester", ".gemini"));
    expect(paths.opencodeConfigDir).toBe(join("/home/tester", ".config", "opencode"));
    expect(paths.codexHome).toBe(join("/home/tester", ".codex"));
  });

  it("should trim whitespace from env values", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      GEMINI_HOME: "  /tmp/gemini  ",
    });

    expect(paths.geminiDir).toBe("/tmp/gemini");
  });

  it("should follow GEMINI_HOME when set", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      GEMINI_HOME: "/tmp/gemini-home",
    });

    expect(paths.geminiDir).toBe("/tmp/gemini-home");
    expect(paths.geminiSettingsPath).toBe("/tmp/gemini-home/settings.json");
  });

  it("should follow OPENCODE_CONFIG_DIR when set", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      OPENCODE_CONFIG_DIR: "/tmp/opencode-config",
    });

    expect(paths.opencodeConfigDir).toBe("/tmp/opencode-config");
    expect(paths.opencodePluginDir).toBe("/tmp/opencode-config/plugin");
  });

  it("should follow XDG_CONFIG_HOME for opencode when explicit override is absent", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      XDG_CONFIG_HOME: "/tmp/xdg",
    });

    expect(paths.opencodeConfigDir).toBe("/tmp/xdg/opencode");
    expect(paths.opencodePluginDir).toBe("/tmp/xdg/opencode/plugin");
  });

  it("should prefer OPENCODE_CONFIG_DIR over XDG_CONFIG_HOME", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      OPENCODE_CONFIG_DIR: "/tmp/opencode-explicit",
      XDG_CONFIG_HOME: "/tmp/xdg",
    });

    expect(paths.opencodeConfigDir).toBe("/tmp/opencode-explicit");
  });

  it("should follow CODEX_HOME when set", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      CODEX_HOME: "/tmp/codex-home",
    });

    expect(paths.codexHome).toBe("/tmp/codex-home");
    expect(paths.codexConfigPath).toBe("/tmp/codex-home/config.toml");
  });

  it("should follow HERMES_HOME when set", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      HERMES_HOME: "/tmp/hermes-home",
    });

    expect(paths.hermesHome).toBe("/tmp/hermes-home");
    expect(paths.hermesPluginDir).toBe("/tmp/hermes-home/plugins");
  });

  it("should use default hermesHome when HERMES_HOME not set", () => {
    const paths = resolveNotifierPaths("/home/tester", {});

    expect(paths.hermesHome).toBe(join("/home/tester", ".hermes"));
    expect(paths.hermesPluginDir).toBe(join("/home/tester", ".hermes", "plugins"));
  });

  it("should follow OPENCLAW_STATE_DIR when set", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      OPENCLAW_STATE_DIR: "/tmp/openclaw-home",
    });

    expect(paths.openclawHome).toBe("/tmp/openclaw-home");
  });

  it("should follow OPENCLAW_CONFIG_PATH when set", () => {
    const paths = resolveNotifierPaths("/home/tester", {
      OPENCLAW_CONFIG_PATH: "/tmp/openclaw/config.json",
    });

    expect(paths.openclawConfigPath).toBe("/tmp/openclaw/config.json");
  });

  it("should be a pure function for the same inputs", () => {
    const env = {
      CODEX_HOME: "/tmp/codex-home",
      GEMINI_HOME: "/tmp/gemini-home",
      OPENCODE_CONFIG_DIR: "/tmp/opencode-home",
      OPENCLAW_STATE_DIR: "/tmp/openclaw-home",
      OPENCLAW_CONFIG_PATH: "/tmp/openclaw/config.json",
    };

    expect(resolveNotifierPaths("/home/tester", env)).toEqual(
      resolveNotifierPaths("/home/tester", env),
    );
  });
});

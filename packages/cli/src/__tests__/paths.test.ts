import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { resolveDefaultPaths } from "../utils/paths.js";

describe("resolveDefaultPaths", () => {
  let savedHermesHome: string | undefined;
  let savedCodexHome: string | undefined;

  beforeEach(() => {
    savedHermesHome = process.env.HERMES_HOME;
    savedCodexHome = process.env.CODEX_HOME;
    delete process.env.HERMES_HOME;
    delete process.env.CODEX_HOME;
  });

  afterEach(() => {
    if (savedHermesHome !== undefined) {
      process.env.HERMES_HOME = savedHermesHome;
    } else {
      delete process.env.HERMES_HOME;
    }
    if (savedCodexHome !== undefined) {
      process.env.CODEX_HOME = savedCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
  });

  it("should resolve all paths relative to home directory", () => {
    const paths = resolveDefaultPaths("/fakehome");
    expect(paths.stateDir).toBe(join("/fakehome", ".config", "pew"));
    expect(paths.binDir).toBe(join("/fakehome", ".config", "pew", "bin"));
    expect(paths.notifyPath).toBe(
      join("/fakehome", ".config", "pew", "bin", "notify.cjs"),
    );
    expect(paths.claudeDir).toBe(join("/fakehome", ".claude"));
    expect(paths.geminiDir).toBe(join("/fakehome", ".gemini"));
    expect(paths.openCodeMessageDir).toBe(
      join("/fakehome", ".local", "share", "opencode", "storage", "message"),
    );
    expect(paths.openCodeDbPath).toBe(
      join("/fakehome", ".local", "share", "opencode", "opencode.db"),
    );
    expect(paths.openclawDir).toBe(join("/fakehome", ".openclaw"));
  });

  it("should use actual homedir when no argument passed", () => {
    const { homedir } = require("node:os");
    const home = homedir();
    const paths = resolveDefaultPaths();
    expect(paths.stateDir).toBe(join(home, ".config", "pew"));
    expect(paths.claudeDir).toBe(join(home, ".claude"));
  });

  it("should resolve codexSessionsDir with default CODEX_HOME", () => {
    const paths = resolveDefaultPaths("/fakehome");
    expect(paths.codexSessionsDir).toBe(join("/fakehome", ".codex", "sessions"));
  });

  it("should resolve vscodeCopilotDirs for stable and insiders", () => {
    const paths = resolveDefaultPaths("/fakehome");
    expect(paths.vscodeCopilotDirs).toBeInstanceOf(Array);
    expect(paths.vscodeCopilotDirs).toHaveLength(2);
    // Both dirs should contain "Code" (stable) or "Code - Insiders"
    expect(paths.vscodeCopilotDirs[0]).toContain("Code");
    expect(paths.vscodeCopilotDirs[1]).toContain("Code - Insiders");
  });

  it("should resolve copilotCliLogsDir to ~/.copilot/logs", () => {
    const paths = resolveDefaultPaths("/fakehome");
    expect(paths.copilotCliLogsDir).toBe(join("/fakehome", ".copilot", "logs"));
  });

  it("should resolve hermesDbPath to ~/.hermes/state.db", () => {
    const paths = resolveDefaultPaths("/fakehome");
    expect(paths.hermesDbPath).toBe(join("/fakehome", ".hermes", "state.db"));
  });

  it("should return exactly 14 path properties", () => {
    const keys = [
      "stateDir",
      "binDir",
      "notifyPath",
      "claudeDir",
      "codexSessionsDir",
      "copilotCliLogsDir",
      "geminiDir",
      "hermesDbPath",
      "kosmosDataDirs",
      "openCodeDbPath",
      "openCodeMessageDir",
      "openclawDir",
      "piSessionsDir",
      "vscodeCopilotDirs",
    ];
    const paths = resolveDefaultPaths("/fakehome");
    expect(Object.keys(paths)).toHaveLength(keys.length);
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        ...keys,
      ]),
    );
  });
});

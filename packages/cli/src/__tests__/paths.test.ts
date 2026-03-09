import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveDefaultPaths } from "../utils/paths.js";

describe("resolveDefaultPaths", () => {
  it("should resolve all paths relative to home directory", () => {
    const paths = resolveDefaultPaths("/fakehome");
    expect(paths.stateDir).toBe(join("/fakehome", ".config", "pew"));
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

  it("should return exactly 6 path properties", () => {
    const paths = resolveDefaultPaths("/fakehome");
    const keys = Object.keys(paths);
    expect(keys).toHaveLength(6);
    expect(keys).toEqual(
      expect.arrayContaining([
        "stateDir",
        "claudeDir",
        "geminiDir",
        "openCodeMessageDir",
        "openCodeDbPath",
        "openclawDir",
      ]),
    );
  });
});

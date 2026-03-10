import { describe, it, expect, vi } from "vitest";
import {
  createTokenDrivers,
  createSessionDrivers,
} from "../../drivers/registry.js";

// ---------------------------------------------------------------------------
// createTokenDrivers()
// ---------------------------------------------------------------------------

describe("createTokenDrivers", () => {
  it("returns empty arrays when no opts are provided", () => {
    const { fileDrivers, dbDrivers } = createTokenDrivers({});
    expect(fileDrivers).toHaveLength(0);
    expect(dbDrivers).toHaveLength(0);
  });

  it("includes claude file driver when claudeDir is set", () => {
    const { fileDrivers, dbDrivers } = createTokenDrivers({ claudeDir: "/tmp/claude" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("claude-code");
    expect(fileDrivers[0].kind).toBe("file");
    expect(dbDrivers).toHaveLength(0);
  });

  it("includes gemini file driver when geminiDir is set", () => {
    const { fileDrivers } = createTokenDrivers({ geminiDir: "/tmp/gemini" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("gemini-cli");
  });

  it("includes opencode json file driver when openCodeMessageDir is set", () => {
    const { fileDrivers } = createTokenDrivers({ openCodeMessageDir: "/tmp/oc" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("opencode");
  });

  it("includes openclaw file driver when openclawDir is set", () => {
    const { fileDrivers } = createTokenDrivers({ openclawDir: "/tmp/openclaw" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("openclaw");
  });

  it("includes codex file driver when codexSessionsDir is set", () => {
    const { fileDrivers } = createTokenDrivers({ codexSessionsDir: "/tmp/codex" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("codex");
  });

  it("returns all 5 file drivers when all dirs are set", () => {
    const { fileDrivers, dbDrivers } = createTokenDrivers({
      claudeDir: "/tmp/claude",
      geminiDir: "/tmp/gemini",
      openCodeMessageDir: "/tmp/oc",
      openclawDir: "/tmp/openclaw",
      codexSessionsDir: "/tmp/codex",
    });
    expect(fileDrivers).toHaveLength(5);
    const sources = fileDrivers.map((d) => d.source);
    expect(sources).toEqual(["claude-code", "gemini-cli", "opencode", "openclaw", "codex"]);
    expect(dbDrivers).toHaveLength(0);
  });

  it("includes sqlite db driver when both openCodeDbPath and openMessageDb are set", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { fileDrivers, dbDrivers } = createTokenDrivers({
      openCodeDbPath: "/tmp/opencode.db",
      openMessageDb: mockOpener,
    });
    expect(fileDrivers).toHaveLength(0);
    expect(dbDrivers).toHaveLength(1);
    expect(dbDrivers[0].source).toBe("opencode");
    expect(dbDrivers[0].kind).toBe("db");
  });

  it("excludes sqlite db driver when openCodeDbPath is set but openMessageDb is missing", () => {
    const { dbDrivers } = createTokenDrivers({ openCodeDbPath: "/tmp/opencode.db" });
    expect(dbDrivers).toHaveLength(0);
  });

  it("excludes sqlite db driver when openMessageDb is set but openCodeDbPath is missing", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { dbDrivers } = createTokenDrivers({ openMessageDb: mockOpener });
    expect(dbDrivers).toHaveLength(0);
  });

  it("returns file + db drivers together when both source types are available", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { fileDrivers, dbDrivers } = createTokenDrivers({
      claudeDir: "/tmp/claude",
      openCodeMessageDir: "/tmp/oc",
      openCodeDbPath: "/tmp/opencode.db",
      openMessageDb: mockOpener,
    });
    expect(fileDrivers).toHaveLength(2);
    expect(dbDrivers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// createSessionDrivers()
// ---------------------------------------------------------------------------

describe("createSessionDrivers", () => {
  it("returns empty arrays when no opts are provided", () => {
    const { fileDrivers, dbDrivers } = createSessionDrivers({});
    expect(fileDrivers).toHaveLength(0);
    expect(dbDrivers).toHaveLength(0);
  });

  it("includes claude session driver when claudeDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ claudeDir: "/tmp/claude" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("claude-code");
    expect(fileDrivers[0].kind).toBe("file");
  });

  it("includes gemini session driver when geminiDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ geminiDir: "/tmp/gemini" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("gemini-cli");
  });

  it("includes opencode json session driver when openCodeMessageDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ openCodeMessageDir: "/tmp/oc" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("opencode");
  });

  it("includes openclaw session driver when openclawDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ openclawDir: "/tmp/openclaw" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("openclaw");
  });

  it("includes codex session driver when codexSessionsDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ codexSessionsDir: "/tmp/codex" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("codex");
  });

  it("returns all 5 file drivers when all dirs are set", () => {
    const { fileDrivers, dbDrivers } = createSessionDrivers({
      claudeDir: "/tmp/claude",
      geminiDir: "/tmp/gemini",
      openCodeMessageDir: "/tmp/oc",
      openclawDir: "/tmp/openclaw",
      codexSessionsDir: "/tmp/codex",
    });
    expect(fileDrivers).toHaveLength(5);
    const sources = fileDrivers.map((d) => d.source);
    expect(sources).toEqual(["claude-code", "gemini-cli", "opencode", "openclaw", "codex"]);
    expect(dbDrivers).toHaveLength(0);
  });

  it("includes sqlite db session driver when both openCodeDbPath and openSessionDb are set", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { fileDrivers, dbDrivers } = createSessionDrivers({
      openCodeDbPath: "/tmp/opencode.db",
      openSessionDb: mockOpener,
    });
    expect(fileDrivers).toHaveLength(0);
    expect(dbDrivers).toHaveLength(1);
    expect(dbDrivers[0].source).toBe("opencode");
    expect(dbDrivers[0].kind).toBe("db");
  });

  it("excludes sqlite db session driver when only openCodeDbPath is set", () => {
    const { dbDrivers } = createSessionDrivers({ openCodeDbPath: "/tmp/opencode.db" });
    expect(dbDrivers).toHaveLength(0);
  });

  it("returns file + db drivers together when both source types are available", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { fileDrivers, dbDrivers } = createSessionDrivers({
      claudeDir: "/tmp/claude",
      geminiDir: "/tmp/gemini",
      openCodeDbPath: "/tmp/opencode.db",
      openSessionDb: mockOpener,
    });
    expect(fileDrivers).toHaveLength(2);
    expect(dbDrivers).toHaveLength(1);
  });
});

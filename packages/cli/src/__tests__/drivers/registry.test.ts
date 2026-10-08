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

  it("includes pi file driver when piSessionsDir is set", () => {
    const { fileDrivers } = createTokenDrivers({ piSessionsDir: "/tmp/pi/sessions" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("pi");
  });

  it("includes copilot-cli file driver when copilotCliLogsDir is set", () => {
    const { fileDrivers } = createTokenDrivers({ copilotCliLogsDir: "/tmp/copilot/logs" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("copilot-cli");
  });

  it("includes copilot-cli token driver when only OTel paths are set", () => {
    const { fileDrivers } = createTokenDrivers({
      copilotCliOtelPaths: ["/tmp/copilot-otel.jsonl"],
    });
    expect(fileDrivers.map((d) => d.source)).toContain("copilot-cli");
  });

  it("returns all 6 file drivers when all dirs are set", () => {
    const { fileDrivers, dbDrivers } = createTokenDrivers({
      claudeDir: "/tmp/claude",
      openCodeMessageDir: "/tmp/oc",
      openclawDir: "/tmp/openclaw",
      piSessionsDir: "/tmp/pi/sessions",
      codexSessionsDir: "/tmp/codex",
      copilotCliLogsDir: "/tmp/copilot/logs",
    });
    expect(fileDrivers).toHaveLength(6);
    const sources = fileDrivers.map((d) => d.source);
    expect(sources).toEqual(["claude-code", "codex", "copilot-cli", "opencode", "openclaw", "pi", ]);
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

  it("includes hermes default DB driver when hermesDbPath and openHermesDb are set", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { dbDrivers } = createTokenDrivers({
      hermesDbPath: "/tmp/hermes/state.db",
      openHermesDb: mockOpener,
    });
    expect(dbDrivers).toHaveLength(1);
    expect(dbDrivers[0].source).toBe("hermes");
  });

  it("includes hermes profile DB drivers when hermesProfileDbPaths are set", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { dbDrivers } = createTokenDrivers({
      openHermesDb: mockOpener,
      hermesProfileDbPaths: [
        { dbPath: "/tmp/hermes/profiles/a/state.db", dbKey: "profiles/a" },
        { dbPath: "/tmp/hermes/profiles/b/state.db", dbKey: "profiles/b" },
      ],
    });
    expect(dbDrivers).toHaveLength(2);
    expect(dbDrivers[0].source).toBe("hermes");
    expect(dbDrivers[1].source).toBe("hermes");
  });

  it("includes both default + profile hermes DB drivers together", () => {
    const mockOpener = vi.fn().mockReturnValue(null);
    const { dbDrivers } = createTokenDrivers({
      hermesDbPath: "/tmp/hermes/state.db",
      openHermesDb: mockOpener,
      hermesProfileDbPaths: [
        { dbPath: "/tmp/hermes/profiles/a/state.db", dbKey: "profiles/a" },
      ],
    });
    expect(dbDrivers).toHaveLength(2);
  });

  it("excludes hermes drivers when openHermesDb is not provided", () => {
    const { dbDrivers } = createTokenDrivers({
      hermesDbPath: "/tmp/hermes/state.db",
      hermesProfileDbPaths: [
        { dbPath: "/tmp/hermes/profiles/a/state.db", dbKey: "profiles/a" },
      ],
    });
    expect(dbDrivers).toHaveLength(0);
  });

  it("includes grok file driver when grokLogsPath is set", () => {
    const { fileDrivers } = createTokenDrivers({
      grokLogsPath: "/tmp/.grok/logs/unified.jsonl",
    });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("grok");
  });

  it("includes workbuddy file driver when workbuddyDir is set", () => {
    const { fileDrivers } = createTokenDrivers({ workbuddyDir: "/tmp/.workbuddy" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("workbuddy");
  });

  it("returns all 8 file drivers when all dirs including grok and workbuddy are set", () => {
    const { fileDrivers } = createTokenDrivers({
      claudeDir: "/tmp/claude",
      codexSessionsDir: "/tmp/codex",
      copilotCliLogsDir: "/tmp/copilot/logs",
      grokLogsPath: "/tmp/.grok/logs/unified.jsonl",
      openCodeMessageDir: "/tmp/oc",
      openclawDir: "/tmp/openclaw",
      piSessionsDir: "/tmp/pi/sessions",
      workbuddyDir: "/tmp/.workbuddy",
    });
    expect(fileDrivers).toHaveLength(8);
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

  it("includes pi session driver when piSessionsDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ piSessionsDir: "/tmp/pi/sessions" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("pi");
  });

  it("includes copilot-cli session driver when copilotCliLogsDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ copilotCliLogsDir: "/tmp/copilot/logs" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("copilot-cli");
  });

  it("returns all 6 file drivers when all dirs are set", () => {
    const { fileDrivers, dbDrivers } = createSessionDrivers({
      claudeDir: "/tmp/claude",
      codexSessionsDir: "/tmp/codex",
      copilotCliLogsDir: "/tmp/copilot/logs",
      openCodeMessageDir: "/tmp/oc",
      openclawDir: "/tmp/openclaw",
      piSessionsDir: "/tmp/pi/sessions",
    });
    expect(fileDrivers).toHaveLength(6);
    const sources = fileDrivers.map((d) => d.source);
    expect(sources).toEqual(["claude-code", "codex", "copilot-cli", "opencode", "openclaw", "pi"]);
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
      openCodeDbPath: "/tmp/opencode.db",
      openSessionDb: mockOpener,
    });
    expect(fileDrivers).toHaveLength(1);
    expect(dbDrivers).toHaveLength(1);
  });

  it("includes grok session driver when grokSessionsDir is set", () => {
    const { fileDrivers } = createSessionDrivers({
      grokSessionsDir: "/tmp/.grok/sessions",
    });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("grok");
  });

  it("includes workbuddy session driver when workbuddyDir is set", () => {
    const { fileDrivers } = createSessionDrivers({ workbuddyDir: "/tmp/.workbuddy" });
    expect(fileDrivers).toHaveLength(1);
    expect(fileDrivers[0].source).toBe("workbuddy");
  });

  it("returns all 8 file drivers when all dirs including grok and workbuddy are set", () => {
    const { fileDrivers } = createSessionDrivers({
      claudeDir: "/tmp/claude",
      codexSessionsDir: "/tmp/codex",
      copilotCliLogsDir: "/tmp/copilot/logs",
      grokSessionsDir: "/tmp/.grok/sessions",
      openCodeMessageDir: "/tmp/oc",
      openclawDir: "/tmp/openclaw",
      piSessionsDir: "/tmp/pi/sessions",
      workbuddyDir: "/tmp/.workbuddy",
    });
    expect(fileDrivers).toHaveLength(8);
  });
});

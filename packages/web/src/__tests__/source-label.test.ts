import { describe, it, expect } from "vitest";
import { sourceLabel } from "../lib/usage-transforms";

describe("sourceLabel", () => {
  it("maps every known source to its human-facing label", () => {
    expect(sourceLabel("claude-code")).toBe("Claude Code");
    expect(sourceLabel("codex")).toBe("Codex");
    expect(sourceLabel("copilot-cli")).toBe("GitHub Copilot CLI");
    expect(sourceLabel("gemini-cli")).toBe("Gemini CLI");
    expect(sourceLabel("grok")).toBe("Grok");
    expect(sourceLabel("hermes")).toBe("Hermes Agent");
    expect(sourceLabel("kosmos")).toBe("Kosmos");
    expect(sourceLabel("opencode")).toBe("OpenCode");
    expect(sourceLabel("openclaw")).toBe("OpenClaw");
    expect(sourceLabel("pi")).toBe("Pi");
    expect(sourceLabel("pmstudio")).toBe("PM Studio");
    expect(sourceLabel("vscode-copilot")).toBe("VS Code Copilot");
    expect(sourceLabel("zcode")).toBe("ZCode");
  });

  it("returns the raw slug for unknown sources", () => {
    expect(sourceLabel("brand-new-cli")).toBe("brand-new-cli");
    expect(sourceLabel("")).toBe("");
  });
});

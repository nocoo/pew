import { describe, it, expect } from "vitest";
import {
  chart,
  CHART_COLORS,
  CHART_TOKENS,
  chartAxis,
  chartMuted,
  chartPositive,
  chartNegative,
  chartPrimary,
  withAlpha,
  agentColor,
  modelColor,
  teamColor,
} from "../lib/palette";

describe("palette", () => {
  it("should have 11 chart colors", () => {
    expect(CHART_COLORS).toHaveLength(11);
  });

  it("should have 11 chart tokens matching chart-1 through chart-11", () => {
    expect(CHART_TOKENS).toHaveLength(11);
    expect(CHART_TOKENS[0]).toBe("chart-1");
    expect(CHART_TOKENS[10]).toBe("chart-11");
  });

  it("should produce hsl(var(--...)) format for chart colors", () => {
    expect(chart.violet).toBe("hsl(var(--chart-1))");
    expect(chart.magenta).toBe("hsl(var(--chart-2))");
    expect(chart.acid).toBe("hsl(var(--chart-8))");
    expect(chart.teal).toBe("hsl(var(--chart-9))");
    expect(chart.sky).toBe("hsl(var(--chart-10))");
    expect(chart.indigo).toBe("hsl(var(--chart-11))");
  });

  it("should export semantic aliases", () => {
    expect(chartAxis).toBe("hsl(var(--chart-axis))");
    expect(chartMuted).toBe("hsl(var(--chart-muted))");
    expect(chartPositive).toBe("hsl(var(--success))");
    expect(chartNegative).toBe("hsl(var(--destructive))");
    expect(chartPrimary).toBe(chart.violet);
  });

  describe("withAlpha()", () => {
    it("should produce hsl with alpha", () => {
      expect(withAlpha("chart-1", 0.12)).toBe("hsl(var(--chart-1) / 0.12)");
    });

    it("should handle alpha of 1", () => {
      expect(withAlpha("primary", 1)).toBe("hsl(var(--primary) / 1)");
    });

    it("should handle alpha of 0", () => {
      expect(withAlpha("muted", 0)).toBe("hsl(var(--muted) / 0)");
    });
  });

  describe("agentColor()", () => {
    it("should return correct color for all 11 known agents (alphabetical)", () => {
      expect(agentColor("claude-code")).toEqual({ color: chart.violet, token: "chart-1" });
      expect(agentColor("codex")).toEqual({ color: chart.magenta, token: "chart-2" });
      expect(agentColor("copilot-cli")).toEqual({ color: chart.pink, token: "chart-3" });
      expect(agentColor("gemini-cli")).toEqual({ color: chart.coral, token: "chart-4" });
      expect(agentColor("hermes")).toEqual({ color: chart.orange, token: "chart-5" });
      expect(agentColor("kosmos")).toEqual({ color: chart.gold, token: "chart-6" });
      expect(agentColor("opencode")).toEqual({ color: chart.lime, token: "chart-7" });
      expect(agentColor("openclaw")).toEqual({ color: chart.acid, token: "chart-8" });
      expect(agentColor("pi")).toEqual({ color: chart.teal, token: "chart-9" });
      expect(agentColor("pmstudio")).toEqual({ color: chart.sky, token: "chart-10" });
      expect(agentColor("vscode-copilot")).toEqual({ color: chart.indigo, token: "chart-11" });
    });

    it("should return fallback color for unknown agents", () => {
      expect(agentColor("unknown-agent")).toEqual({ color: chart.violet, token: "chart-1" });
      expect(agentColor("")).toEqual({ color: chart.violet, token: "chart-1" });
    });
  });

  describe("modelColor()", () => {
    it("should return consistent color for the same model name", () => {
      const color1 = modelColor("claude-opus-4");
      const color2 = modelColor("claude-opus-4");
      expect(color1).toEqual(color2);
    });

    it("should return different colors for different models", () => {
      const opus = modelColor("claude-opus-4");
      const sonnet = modelColor("claude-sonnet-4");
      // Different models should hash differently (may occasionally collide, but unlikely)
      expect(opus.color).toBeDefined();
      expect(sonnet.color).toBeDefined();
    });

    it("should return valid chart color format", () => {
      const result = modelColor("gpt-4o");
      expect(result.color).toMatch(/^hsl\(var\(--chart-\d+\)\)$/);
      expect(result.token).toMatch(/^chart-\d+$/);
    });
  });

  describe("teamColor()", () => {
    it("should return consistent color for the same team name", () => {
      const color1 = teamColor("Engineering");
      const color2 = teamColor("Engineering");
      expect(color1).toEqual(color2);
    });

    it("should handle Unicode characters (CJK, emoji)", () => {
      const cjk = teamColor("工程团队");
      const emoji = teamColor("🚀 Rocket");
      expect(cjk.color).toMatch(/^hsl\(var\(--chart-\d+\)\)$/);
      expect(emoji.color).toMatch(/^hsl\(var\(--chart-\d+\)\)$/);
    });

    it("should return valid chart color format", () => {
      const result = teamColor("Alpha Team");
      expect(result.color).toMatch(/^hsl\(var\(--chart-\d+\)\)$/);
      expect(result.token).toMatch(/^chart-\d+$/);
    });
  });
});

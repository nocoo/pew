/**
 * CLI smoke tests for @nocoo/pew.
 *
 * Validates that the CLI entry point and all subcommands are defined correctly.
 */
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";

describe("CLI main command", () => {
  it("should have correct meta", () => {
    expect(main.meta?.name).toBe("pew");
    expect(main.meta?.version).toBe("1.14.7");
    expect(main.meta?.description).toBeDefined();
  });

  it("should register all subcommands", () => {
    const subCommands = main.subCommands;
    expect(subCommands).toBeDefined();

    const names = Object.keys(subCommands!);
    expect(names).toContain("sync");
    expect(names).toContain("status");
    expect(names).toContain("login");
    expect(names).toContain("notify");
    expect(names).toContain("init");
    expect(names).toContain("uninstall");
    expect(names).toContain("reset");
    expect(names).toContain("update");
  });

  it("should have exactly 8 subcommands", () => {
    const names = Object.keys(main.subCommands!);
    expect(names).toHaveLength(8);
  });
});

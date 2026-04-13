/**
 * CLI smoke tests for @nocoo/pew.
 *
 * Validates that the CLI entry point and all subcommands are defined correctly.
 */
import { readVersion } from "@nocoo/cli-base";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const expectedVersion = readVersion(dirname(dirname(__dirname)));

describe("CLI main command", () => {
  it("should have correct meta", () => {
    expect(main.meta?.name).toBe("pew");
    expect(main.meta?.version).toBe(expectedVersion);
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
    expect(names).toContain("logout");
  });

  it("should have exactly 9 subcommands", () => {
    const names = Object.keys(main.subCommands!);
    expect(names).toHaveLength(9);
  });
});

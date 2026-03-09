import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getClaudeHookStatus,
  installClaudeHook,
  uninstallClaudeHook,
} from "../notifier/claude-hook.js";

describe("Claude hook installer", () => {
  let tempDir: string;
  let settingsPath: string;
  const notifyPath = "/tmp/pew/bin/notify.cjs";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-claude-hook-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a new settings file when missing", async () => {
    const result = await installClaudeHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(saved.hooks.SessionEnd).toHaveLength(1);
    expect(saved.hooks.SessionEnd[0].hooks[0].command).toContain("--source=claude-code");
  });

  it("appends to existing SessionEnd hooks without overwriting other entries", async () => {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionEnd: [
              {
                hooks: [{ type: "command", command: "echo existing" }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await installClaudeHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(saved.hooks.SessionEnd).toHaveLength(2);
    expect(saved.hooks.SessionEnd[0].hooks[0].command).toBe("echo existing");
  });

  it("is idempotent when the hook is already installed", async () => {
    await installClaudeHook({ settingsPath, notifyPath });

    const result = await installClaudeHook({ settingsPath, notifyPath });

    expect(result.changed).toBe(false);
  });

  it("normalizes a matching hook with a missing type", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionEnd: [
              {
                hooks: [{ command: `/usr/bin/env node ${notifyPath} --source=claude-code` }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await installClaudeHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(saved.hooks.SessionEnd[0].hooks[0].type).toBe("command");
  });

  it("uninstalls only the pew hook and preserves other entries", async () => {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionEnd: [
              {
                hooks: [
                  { type: "command", command: "echo existing" },
                  {
                    type: "command",
                    command: `/usr/bin/env node ${notifyPath} --source=claude-code`,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await uninstallClaudeHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(saved.hooks.SessionEnd[0].hooks).toEqual([
      { type: "command", command: "echo existing" },
    ]);
  });

  it("returns skip when uninstalling from a missing settings file", async () => {
    const result = await uninstallClaudeHook({ settingsPath, notifyPath });

    expect(result.action).toBe("skip");
    expect(result.changed).toBe(false);
  });

  it("reports installed and not-installed status", async () => {
    expect(await getClaudeHookStatus({ settingsPath, notifyPath })).toBe("not-installed");

    await installClaudeHook({ settingsPath, notifyPath });

    expect(await getClaudeHookStatus({ settingsPath, notifyPath })).toBe("installed");
  });

  it("creates a backup file before rewriting an existing settings file", async () => {
    await writeFile(settingsPath, "{}\n", "utf8");

    const result = await installClaudeHook({ settingsPath, notifyPath });

    expect(result.backupPath).toContain(".bak.");
  });
});

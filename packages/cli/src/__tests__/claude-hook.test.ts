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

  it("returns skip for invalid settings during install and uninstall", async () => {
    await writeFile(settingsPath, "{invalid-json}\n", "utf8");

    const installResult = await installClaudeHook({ settingsPath, notifyPath });
    const uninstallResult = await uninstallClaudeHook({ settingsPath, notifyPath });

    expect(installResult.action).toBe("skip");
    expect(uninstallResult.action).toBe("skip");
    expect(uninstallResult.detail).toContain("Invalid Claude settings.json");
  });

  it("reports installed and not-installed status", async () => {
    expect(await getClaudeHookStatus({ settingsPath, notifyPath })).toBe("not-installed");

    await installClaudeHook({ settingsPath, notifyPath });

    expect(await getClaudeHookStatus({ settingsPath, notifyPath })).toBe("installed");
  });

  it("reports error status for invalid settings JSON", async () => {
    await writeFile(settingsPath, "{invalid-json}\n", "utf8");

    expect(await getClaudeHookStatus({ settingsPath, notifyPath })).toBe("error");
  });

  it("returns skip when the settings file has no pew hook to remove", async () => {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionEnd: [{ hooks: [{ type: "command", command: "echo existing" }] }],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await uninstallClaudeHook({ settingsPath, notifyPath });

    expect(result.action).toBe("skip");
    expect(result.changed).toBe(false);
  });

  it("creates a backup file before rewriting an existing settings file", async () => {
    await writeFile(settingsPath, "{}\n", "utf8");

    const result = await installClaudeHook({ settingsPath, notifyPath });

    expect(result.backupPath).toContain(".bak.");
  });

  it("quotes notify paths that contain spaces", async () => {
    const spacedPath = join(tempDir, "notify dir", "notify.cjs");

    await installClaudeHook({ settingsPath, notifyPath: spacedPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(saved.hooks.SessionEnd[0].hooks[0].command).toContain(`"${spacedPath}"`);
  });

  it("re-throws non-ENOENT errors when reading settings", async () => {
    const fsMock = {
      readFile: async () => {
        const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
      writeFile: async () => {},
      mkdir: async () => {},
    };

    await expect(
      installClaudeHook({ settingsPath, notifyPath, fs: fsMock }),
    ).rejects.toThrow("EACCES");
  });

  it("falls back to string-based mkdir when URL-based mkdir fails", async () => {
    let mkdirCallCount = 0;
    const fsMock = {
      readFile: async () => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
      writeFile: async () => {},
      mkdir: async (p: string) => {
        mkdirCallCount++;
        if (mkdirCallCount === 1) {
          // First call (URL-based path) fails
          throw new Error("Invalid URL");
        }
        // Second call (string-based fallback) succeeds
      },
    };

    const result = await installClaudeHook({ settingsPath, notifyPath, fs: fsMock });
    expect(result.changed).toBe(true);
    expect(mkdirCallCount).toBe(2);
  });

  it("falls back to '.' when settingsPath has no slash and URL mkdir fails", async () => {
    const captured: string[] = [];
    const fsMock = {
      readFile: async () => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
      writeFile: async () => {},
      mkdir: async (p: string) => {
        captured.push(p);
        if (captured.length === 1) throw new Error("Invalid URL");
      },
    };
    // Settings path with no slash — fallback should use "."
    await installClaudeHook({ settingsPath: "settings.json", notifyPath, fs: fsMock });
    expect(captured).toHaveLength(2);
    expect(captured[1]).toBe(".");
  });

  it("reports error when settings JSON is a top-level array", async () => {
    // Top-level array — hits the `Array.isArray(parsed)` invalid branch in loadSettings
    await writeFile(settingsPath, JSON.stringify(["not", "an", "object"]), "utf8");
    const status = await getClaudeHookStatus({ settingsPath, notifyPath });
    expect(status).toBe("error");
  });

  it("ignores non-object hook entries inside a SessionEnd hooks array", async () => {
    // Existing settings: SessionEnd entry with an entry whose .hooks contains non-object items
    // (null, string, number) — covers `!hook || typeof hook !== 'object'` guards in
    // normalizeEntry, stripCommand, and hasCommand.
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionEnd: [
            {
              matcher: "*",
              hooks: [
                null,
                "not-an-object",
                42,
                { type: "command", command: "echo other" },
              ],
            },
          ],
        },
      }),
      "utf8",
    );

    // Status should be 'not-installed' (commandMatches false for all valid entries, junk skipped)
    expect(
      await getClaudeHookStatus({ settingsPath, notifyPath }),
    ).toBe("not-installed");

    // Install should preserve junk entries verbatim
    await installClaudeHook({ settingsPath, notifyPath });
    const after = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: { SessionEnd: Array<{ hooks: unknown[] }> };
    };
    const entry = after.hooks.SessionEnd[0]!;
    // Original junk preserved; pew hook appended
    expect(entry.hooks).toEqual(
      expect.arrayContaining([null, "not-an-object", 42]),
    );
    expect(after.hooks.SessionEnd.length).toBe(2);

    // Uninstall should leave the junk entries alone
    await uninstallClaudeHook({ settingsPath, notifyPath });
    const afterUninstall = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: { SessionEnd: Array<{ hooks: unknown[] }> };
    };
    const entryAfter = afterUninstall.hooks.SessionEnd[0]!;
    expect(entryAfter.hooks).toEqual(
      expect.arrayContaining([null, "not-an-object", 42]),
    );
  });

  it("leaves SessionEnd entries untouched when their .hooks is not an array", async () => {
    // Covers the early-return branch in normalizeEntry/stripCommand when hooks is not an array.
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionEnd: [
            { matcher: "*", hooks: "not-an-array" },
            { matcher: "build" }, // hooks missing entirely
          ],
        },
      }),
      "utf8",
    );
    expect(
      await getClaudeHookStatus({ settingsPath, notifyPath }),
    ).toBe("not-installed");

    // Uninstall is a no-op (nothing to strip) — should report "skip" or "unchanged"
    const res = await uninstallClaudeHook({ settingsPath, notifyPath });
    expect(res.changed).toBe(false);
  });
});

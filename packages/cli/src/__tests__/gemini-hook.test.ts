import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getGeminiHookStatus,
  installGeminiHook,
  uninstallGeminiHook,
} from "../notifier/gemini-hook.js";

describe("Gemini hook installer", () => {
  let tempDir: string;
  let settingsPath: string;
  const notifyPath = "/tmp/pew/bin/notify.cjs";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-gemini-hook-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("installs hooks into a new settings file and enables hooks", async () => {
    const result = await installGeminiHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(saved.tools.enableHooks).toBe(true);
    expect(saved.hooks.SessionEnd[0].matcher).toBe(
      "exit|clear|logout|prompt_input_exit|other",
    );
    expect(saved.hooks.SessionEnd[0].hooks[0].name).toBe("pew-tracker");
  });

  it("repairs enableHooks, name, command and matcher for an existing hook", async () => {
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          tools: { enableHooks: false },
          hooks: {
            SessionEnd: [
              {
                hooks: [{ name: "pew-tracker", command: "echo old" }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await installGeminiHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(saved.tools.enableHooks).toBe(true);
    expect(saved.hooks.SessionEnd[0].matcher).toBe(
      "exit|clear|logout|prompt_input_exit|other",
    );
    expect(saved.hooks.SessionEnd[0].hooks[0].type).toBe("command");
    expect(saved.hooks.SessionEnd[0].hooks[0].command).toContain("--source=gemini-cli");
  });

  it("is idempotent when the hook is already installed", async () => {
    await installGeminiHook({ settingsPath, notifyPath });

    const result = await installGeminiHook({ settingsPath, notifyPath });

    expect(result.changed).toBe(false);
  });

  it("removes the pew hook and keeps enableHooks intact", async () => {
    await installGeminiHook({ settingsPath, notifyPath });

    const result = await uninstallGeminiHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(saved.tools.enableHooks).toBe(true);
    expect(saved.hooks).toBeUndefined();
  });

  it("reports installed and not-installed status", async () => {
    expect(await getGeminiHookStatus({ settingsPath, notifyPath })).toBe("not-installed");

    await installGeminiHook({ settingsPath, notifyPath });

    expect(await getGeminiHookStatus({ settingsPath, notifyPath })).toBe("installed");
  });

  it("uninstall keeps other hooks when only pew hook is removed", async () => {
    // Write a settings file with the pew hook AND a custom hook in the same entry
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          tools: { enableHooks: true },
          hooks: {
            SessionEnd: [
              {
                matcher: "exit|clear|logout|prompt_input_exit|other",
                hooks: [
                  { name: "pew-tracker", type: "command", command: `/usr/bin/env node '${notifyPath}' --source=gemini-cli` },
                  { name: "custom-hook", type: "command", command: "echo done" },
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

    const result = await uninstallGeminiHook({ settingsPath, notifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    // The entry should still exist with the custom hook
    expect(saved.hooks.SessionEnd).toHaveLength(1);
    expect(saved.hooks.SessionEnd[0].hooks).toHaveLength(1);
    expect(saved.hooks.SessionEnd[0].hooks[0].name).toBe("custom-hook");
  });

  it("single-quotes notifyPath containing special characters", async () => {
    const specialNotifyPath = "/tmp/my pew dir/bin/notify.cjs";
    const result = await installGeminiHook({ settingsPath, notifyPath: specialNotifyPath });
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));

    expect(result.changed).toBe(true);
    // The command should have single-quoted the path due to the space
    const command = saved.hooks.SessionEnd[0].hooks[0].command as string;
    expect(command).toContain("'");
    expect(command).toContain("my pew dir");
  });

  describe("install edge cases", () => {
    it("skips install when settings.json contains invalid JSON", async () => {
      const fs = {
        readFile: async () => "not valid json {{{",
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const result = await installGeminiHook({ settingsPath, notifyPath, fs });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
      expect(result.detail).toBe("Invalid Gemini settings.json");
    });

    it("skips install when settings.json parses to a JSON array", async () => {
      const fs = {
        readFile: async () => "[]",
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const result = await installGeminiHook({ settingsPath, notifyPath, fs });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
      expect(result.detail).toBe("Invalid Gemini settings.json");
    });

    it("skips install when settings.json parses to a primitive", async () => {
      const fs = {
        readFile: async () => '"just a string"',
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const result = await installGeminiHook({ settingsPath, notifyPath, fs });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
    });
  });

  describe("uninstall edge cases", () => {
    it("skips uninstall when settings.json is missing (ENOENT)", async () => {
      const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const fs = {
        readFile: async () => { throw enoent; },
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const result = await uninstallGeminiHook({ settingsPath, notifyPath, fs });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
      expect(result.detail).toBe("Gemini settings.json not found");
    });

    it("skips uninstall when settings.json contains invalid JSON", async () => {
      const fs = {
        readFile: async () => "{{broken",
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const result = await uninstallGeminiHook({ settingsPath, notifyPath, fs });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
      expect(result.detail).toBe("Invalid Gemini settings.json");
    });

    it("skips uninstall when hook is not installed in valid settings", async () => {
      const fs = {
        readFile: async () => JSON.stringify({ tools: { enableHooks: true }, hooks: {} }),
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const result = await uninstallGeminiHook({ settingsPath, notifyPath, fs });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
      expect(result.detail).toBe("Gemini hook not installed");
    });

    it("skips uninstall when SessionEnd has entries but none match pew hook", async () => {
      const fs = {
        readFile: async () => JSON.stringify({
          tools: { enableHooks: true },
          hooks: {
            SessionEnd: [
              { matcher: "exit", hooks: [{ name: "other-tool", type: "command", command: "echo hi" }] },
            ],
          },
        }),
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const result = await uninstallGeminiHook({ settingsPath, notifyPath, fs });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
      expect(result.detail).toBe("Gemini hook not installed");
    });
  });

  describe("status edge cases", () => {
    it("returns not-installed for valid settings without hook", async () => {
      const fs = {
        readFile: async () => JSON.stringify({ tools: { enableHooks: true } }),
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const status = await getGeminiHookStatus({ settingsPath, notifyPath, fs });
      expect(status).toBe("not-installed");
    });

    it("returns error for invalid settings", async () => {
      const fs = {
        readFile: async () => "not json",
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const status = await getGeminiHookStatus({ settingsPath, notifyPath, fs });
      expect(status).toBe("error");
    });

    it("returns error when settings parses to an array", async () => {
      const fs = {
        readFile: async () => "[]",
        writeFile: async () => {},
        mkdir: async () => {},
      };
      const status = await getGeminiHookStatus({ settingsPath, notifyPath, fs });
      expect(status).toBe("error");
    });
  });

  describe("loadSettings edge cases", () => {
    it("rethrows non-ENOENT errors from readFile", async () => {
      const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
      const fs = {
        readFile: async () => { throw eperm; },
        writeFile: async () => {},
        mkdir: async () => {},
      };
      // loadSettings is internal, but we can trigger it via installGeminiHook
      await expect(installGeminiHook({ settingsPath, notifyPath, fs })).rejects.toThrow("EPERM");
    });

    it("rethrows non-ENOENT errors via uninstallGeminiHook", async () => {
      const eacces = Object.assign(new Error("EACCES"), { code: "EACCES" });
      const fs = {
        readFile: async () => { throw eacces; },
        writeFile: async () => {},
        mkdir: async () => {},
      };
      await expect(uninstallGeminiHook({ settingsPath, notifyPath, fs })).rejects.toThrow("EACCES");
    });

    it("rethrows non-ENOENT errors via getGeminiHookStatus", async () => {
      const eio = Object.assign(new Error("EIO"), { code: "EIO" });
      const fs = {
        readFile: async () => { throw eio; },
        writeFile: async () => {},
        mkdir: async () => {},
      };
      await expect(getGeminiHookStatus({ settingsPath, notifyPath, fs })).rejects.toThrow("EIO");
    });
  });

  describe("normalizeEntry edge cases", () => {
    it("repairs hook name when it differs but command matches", async () => {
      // Hook has wrong name but matching command — should be repaired to "pew-tracker"
      const command = `/usr/bin/env node '${notifyPath}' --source=gemini-cli`;
      await writeFile(
        settingsPath,
        `${JSON.stringify(
          {
            tools: { enableHooks: true },
            hooks: {
              SessionEnd: [
                {
                  matcher: "exit|clear|logout|prompt_input_exit|other",
                  hooks: [{ name: "wrong-name", type: "command", command }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const result = await installGeminiHook({ settingsPath, notifyPath });
      const saved = JSON.parse(await readFile(settingsPath, "utf8"));

      expect(result.changed).toBe(true);
      expect(saved.hooks.SessionEnd[0].hooks[0].name).toBe("pew-tracker");
    });

    it("does not modify entries without hooks array", async () => {
      // Entry with no hooks property — normalizeEntry should return it unchanged
      await writeFile(
        settingsPath,
        `${JSON.stringify(
          {
            tools: { enableHooks: true },
            hooks: {
              SessionEnd: [
                { matcher: "exit" },
              ],
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const result = await installGeminiHook({ settingsPath, notifyPath });
      const saved = JSON.parse(await readFile(settingsPath, "utf8"));

      expect(result.changed).toBe(true);
      // Original entry preserved, plus new pew hook entry appended
      expect(saved.hooks.SessionEnd).toHaveLength(2);
      expect(saved.hooks.SessionEnd[0].matcher).toBe("exit");
      expect(saved.hooks.SessionEnd[1].hooks[0].name).toBe("pew-tracker");
    });
  });
});

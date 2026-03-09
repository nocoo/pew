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
});

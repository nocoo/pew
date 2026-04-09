import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCodexNotifierStatus,
  installCodexNotifier,
  uninstallCodexNotifier,
} from "../notifier/codex-notifier.js";

describe("Codex notifier installer", () => {
  let tempDir: string;
  let configPath: string;
  let originalBackupPath: string;
  const notifyPath = "/tmp/pew/bin/notify.cjs";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-codex-notifier-"));
    configPath = join(tempDir, "config.toml");
    originalBackupPath = join(tempDir, "codex_notify_original.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("inserts notify when config has none", async () => {
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const updated = await readFile(configPath, "utf8");

    expect(result.changed).toBe(true);
    expect(updated).toContain(
      'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]',
    );
  });

  it("replaces an existing multiline notify and stores the original once", async () => {
    await writeFile(
      configPath,
      [
        'model = "gpt-5"',
        "notify = [",
        '  "/usr/bin/env",',
        '  "node",',
        '  "/tmp/original-notify.js"',
        "]",
      ].join("\n"),
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(backup.notify).toEqual([
      "/usr/bin/env",
      "node",
      "/tmp/original-notify.js",
    ]);
  });

  it("is idempotent when the pew notify is already installed", async () => {
    await writeFile(
      configPath,
      'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });

    expect(result.changed).toBe(false);
  });

  it("skips install when config.toml is missing", async () => {
    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });

    expect(result.action).toBe("skip");
    expect(result.detail).toContain("not found");
  });

  it("restores the original notify from backup on uninstall", async () => {
    await writeFile(
      configPath,
      'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
      "utf8",
    );
    await writeFile(
      originalBackupPath,
      JSON.stringify({
        notify: ["/usr/bin/env", "node", "/tmp/original-notify.js"],
      }),
      "utf8",
    );

    const result = await uninstallCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const updated = await readFile(configPath, "utf8");

    expect(result.changed).toBe(true);
    expect(updated).toContain(
      'notify = ["/usr/bin/env", "node", "/tmp/original-notify.js"]',
    );
  });

  it("removes the notify line when uninstalling without a backup", async () => {
    await writeFile(
      configPath,
      [
        'model = "gpt-5"',
        'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]',
      ].join("\n"),
      "utf8",
    );

    const result = await uninstallCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const updated = await readFile(configPath, "utf8");

    expect(result.changed).toBe(true);
    expect(updated).not.toContain("notify =");
  });

  it("skips uninstall when the pew notify is not installed", async () => {
    await writeFile(configPath, 'notify = ["/usr/bin/env", "node", "/tmp/original.js"]\n', "utf8");

    const result = await uninstallCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });

    expect(result.action).toBe("skip");
    expect(result.detail).toContain("not installed");
  });

  it("reports installed and not-installed status", async () => {
    expect(
      await getCodexNotifierStatus({ configPath, notifyPath, originalBackupPath }),
    ).toBe("not-installed");

    await writeFile(
      configPath,
      'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
      "utf8",
    );

    expect(
      await getCodexNotifierStatus({ configPath, notifyPath, originalBackupPath }),
    ).toBe("installed");
  });

  it("preserves an explicit empty notify array", async () => {
    await writeFile(configPath, "notify = []\n", "utf8");

    await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });

    const backup = await readFile(originalBackupPath, "utf8").catch(() => null);
    expect(backup).toBeNull();
  });

  it("replaces a malformed multiline notify array without crashing", async () => {
    await writeFile(
      configPath,
      [
        'model = "gpt-5"',
        "notify = [",
        '  "/usr/bin/env",',
        '  "node",',
        '  "/tmp/broken-notify.js"',
      ].join("\n"),
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const updated = await readFile(configPath, "utf8");

    expect(result.changed).toBe(true);
    expect(updated).toContain('"/tmp/pew/bin/notify.cjs"');
  });

  // ---- TOML escape handling ----

  it("parses notify with escaped quotes in double-quoted strings", async () => {
    // notify = ["bash", "-lc", "echo \"x\""]
    await writeFile(
      configPath,
      'notify = ["bash", "-lc", "echo \\"x\\""]\n',
      "utf8",
    );

    // Install should detect existing notify and back it up correctly
    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    // The parsed backup should contain the unescaped value
    expect(backup.notify).toEqual(["bash", "-lc", 'echo "x"']);
  });

  it("parses notify with backslash paths (Windows-style)", async () => {
    // notify = ["C:\\Users\\foo\\notify.exe", "--flag"]
    await writeFile(
      configPath,
      'notify = ["C:\\\\Users\\\\foo\\\\notify.exe", "--flag"]\n',
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(backup.notify).toEqual(["C:\\Users\\foo\\notify.exe", "--flag"]);
  });

  it("does not process escapes in single-quoted strings (TOML literal strings)", async () => {
    // In TOML, single-quoted strings are literal — backslash has no special meaning
    // notify = ['C:\Users\foo\notify.exe', '--flag']
    await writeFile(
      configPath,
      "notify = ['C:\\Users\\foo\\notify.exe', '--flag']\n",
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    // Single-quoted: backslashes are kept literally
    expect(backup.notify).toEqual(["C:\\Users\\foo\\notify.exe", "--flag"]);
  });

  it("parses \\b and \\f escape sequences in double-quoted strings", async () => {
    // \b = backspace (U+0008), \f = form feed (U+000C)
    await writeFile(
      configPath,
      'notify = ["a\\bb", "c\\fd"]\n',
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(backup.notify).toEqual(["a\bb", "c\fd"]);
  });

  it("parses \\uXXXX unicode escape sequences in double-quoted strings", async () => {
    // \u00E9 = é, \u0041 = A
    await writeFile(
      configPath,
      'notify = ["caf\\u00E9", "\\u0041BC"]\n',
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(backup.notify).toEqual(["café", "ABC"]);
  });

  it("parses \\UXXXXXXXX unicode escape sequences in double-quoted strings", async () => {
    // \U0001F600 = 😀 (grinning face emoji)
    await writeFile(
      configPath,
      'notify = ["hi\\U0001F600"]\n',
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(backup.notify).toEqual(["hi\u{1F600}"]);
  });

  it("preserves backslash for invalid unicode escapes", async () => {
    // \u00GG is not valid hex, should preserve the backslash literally
    await writeFile(
      configPath,
      'notify = ["bad\\u00GG"]\n',
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    // Unknown/invalid escape: backslash preserved
    expect(backup.notify).toEqual(["bad\\u00GG"]);
  });

  it("correctly restores a backup containing escaped quotes on uninstall", async () => {
    // Simulate: pew was installed, original had escaped quotes
    await writeFile(
      configPath,
      'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
      "utf8",
    );
    await writeFile(
      originalBackupPath,
      JSON.stringify({ notify: ["bash", "-lc", 'echo "hello"'] }),
      "utf8",
    );

    const result = await uninstallCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const updated = await readFile(configPath, "utf8");

    expect(result.changed).toBe(true);
    // formatTomlStringArray uses JSON.stringify which correctly escapes
    expect(updated).toContain('notify = ["bash", "-lc", "echo \\"hello\\""]');
  });

  it("handles multiline notify with escaped quotes", async () => {
    await writeFile(
      configPath,
      [
        'model = "gpt-5"',
        "notify = [",
        '  "bash",',
        '  "-lc",',
        '  "echo \\"done\\""',
        "]",
      ].join("\n"),
      "utf8",
    );

    const result = await installCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });
    const backup = JSON.parse(await readFile(originalBackupPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(backup.notify).toEqual(["bash", "-lc", 'echo "done"']);
  });

  it("skips uninstall when config.toml is missing", async () => {
    // configPath does not exist — uninstall should skip
    const result = await uninstallCodexNotifier({
      configPath,
      notifyPath,
      originalBackupPath,
    });

    expect(result.action).toBe("skip");
    expect(result.detail).toContain("not found");
  });

  it("re-throws non-ENOENT errors from readOptional", async () => {
    const fsMock = {
      readFile: async () => {
        const err = new Error("EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
      writeFile: async () => {},
      mkdir: async () => {},
    };

    await expect(
      installCodexNotifier({
        configPath,
        notifyPath,
        originalBackupPath,
        fs: fsMock,
      }),
    ).rejects.toThrow("EACCES");
  });
});

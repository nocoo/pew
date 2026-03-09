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
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getOpenCodePluginStatus,
  installOpenCodePlugin,
  uninstallOpenCodePlugin,
} from "../notifier/opencode-plugin.js";

describe("OpenCode plugin installer", () => {
  let tempDir: string;
  let pluginDir: string;
  const notifyPath = "/tmp/pew/bin/notify.cjs";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-opencode-plugin-"));
    pluginDir = join(tempDir, "plugin");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("installs the plugin into a missing directory", async () => {
    const result = await installOpenCodePlugin({ pluginDir, notifyPath });
    const pluginPath = join(pluginDir, "pew-tracker.js");
    const source = await readFile(pluginPath, "utf8");

    expect(result.changed).toBe(true);
    expect(source).toContain("PEW_TRACKER_PLUGIN");
    expect(source).toContain("--source=opencode");
  });

  it("is idempotent when the generated source matches", async () => {
    await installOpenCodePlugin({ pluginDir, notifyPath });

    const result = await installOpenCodePlugin({ pluginDir, notifyPath });

    expect(result.changed).toBe(false);
  });

  it("backs up and replaces a changed plugin file", async () => {
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "pew-tracker.js"), "// old", "utf8");

    const result = await installOpenCodePlugin({ pluginDir, notifyPath });

    expect(result.backupPath).toContain(".bak.");
    expect(await getOpenCodePluginStatus({ pluginDir, notifyPath })).toBe("installed");
  });

  it("uninstalls only files that contain the pew marker", async () => {
    await installOpenCodePlugin({ pluginDir, notifyPath });

    const result = await uninstallOpenCodePlugin({ pluginDir, notifyPath });

    expect(result.changed).toBe(true);
    expect(await getOpenCodePluginStatus({ pluginDir, notifyPath })).toBe("not-installed");
  });

  it("refuses to remove a plugin file without the pew marker", async () => {
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "pew-tracker.js"), "// user file", "utf8");

    const result = await uninstallOpenCodePlugin({ pluginDir, notifyPath });

    expect(result.changed).toBe(false);
    expect(result.warnings).toContain("File does not contain pew marker");
  });
});

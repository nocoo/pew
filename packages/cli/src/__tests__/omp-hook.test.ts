import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installOmpHook, uninstallOmpHook, getOmpHookStatus } from "../notifier/omp-hook.js";

describe("omp-hook", () => {
  let testDir: string;
  let extensionPath: string;
  const notifyPath = "/home/test/.config/pew/bin/notify.cjs";

  beforeEach(async () => {
    testDir = join(tmpdir(), `pew-omp-hook-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    extensionPath = join(testDir, "pew-sync.ts");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("installOmpHook", () => {
    it("creates extension file targeting the omp package and source tag", async () => {
      const result = await installOmpHook({ extensionPath, notifyPath });
      expect(result.source).toBe("omp");
      expect(result.action).toBe("install");
      expect(result.changed).toBe(true);

      const content = await readFile(extensionPath, "utf8");
      expect(content).toContain("PEW_OMP_HOOK");
      expect(content).toContain("session_shutdown");
      expect(content).toContain("@oh-my-pi/pi-coding-agent");
      expect(content).toContain(notifyPath);
      expect(content).toContain("--source=omp");
    });

    it("reports unchanged if already installed", async () => {
      await installOmpHook({ extensionPath, notifyPath });
      const result = await installOmpHook({ extensionPath, notifyPath });
      expect(result.changed).toBe(false);
      expect(result.detail).toContain("already installed");
    });

    it("updates a stale pew-managed extension", async () => {
      await writeFile(extensionPath, "// PEW_OMP_HOOK\nold content\n", "utf8");
      const result = await installOmpHook({ extensionPath, notifyPath });
      expect(result.changed).toBe(true);

      const content = await readFile(extensionPath, "utf8");
      expect(content).toContain("session_shutdown");
    });
  });

  describe("uninstallOmpHook", () => {
    it("removes extension file", async () => {
      await installOmpHook({ extensionPath, notifyPath });
      const result = await uninstallOmpHook({ extensionPath, notifyPath });
      expect(result.source).toBe("omp");
      expect(result.action).toBe("uninstall");
      expect(result.changed).toBe(true);
    });

    it("skips if file not found", async () => {
      const result = await uninstallOmpHook({ extensionPath, notifyPath });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
    });

    it("skips if file not managed by pew", async () => {
      await writeFile(extensionPath, "// some other extension\n", "utf8");
      const result = await uninstallOmpHook({ extensionPath, notifyPath });
      expect(result.action).toBe("skip");
      expect(result.changed).toBe(false);
    });
  });

  describe("getOmpHookStatus", () => {
    it("returns installed when hook exists", async () => {
      await installOmpHook({ extensionPath, notifyPath });
      expect(await getOmpHookStatus({ extensionPath, notifyPath })).toBe("installed");
    });

    it("returns not-installed when hook missing", async () => {
      expect(await getOmpHookStatus({ extensionPath, notifyPath })).toBe("not-installed");
    });

    it("returns not-installed when file exists but no marker", async () => {
      await writeFile(extensionPath, "// other extension\n", "utf8");
      expect(await getOmpHookStatus({ extensionPath, notifyPath })).toBe("not-installed");
    });
  });
});

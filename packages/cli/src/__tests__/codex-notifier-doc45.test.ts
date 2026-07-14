/**
 * Tests for the doc 45 §7.2 + §8 hardening of the Codex notifier:
 *   - runtime command uses an injected execPath (or falls back to process.execPath)
 *   - install refuses to take the notify slot when the backup is stale
 *     and the current top-level notify is not Pew-owned
 *   - install never stores a legacy Pew command as saved-original
 *   - uninstall retains the backup when driver validation fails
 *   - status recognises both legacy /usr/bin/env node and the new
 *     runtime command variants as Pew-owned
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCodexNotifierStatus,
  installCodexNotifier,
  uninstallCodexNotifier,
} from "../notifier/codex-notifier.js";

describe("Codex notifier — doc 45 §7.2 runtime + §8 ownership hardening", () => {
  let tempDir: string;
  let configPath: string;
  let originalBackupPath: string;
  const notifyPath = "/tmp/pew/bin/notify.cjs";
  const runtimePath = "/usr/local/bin/node";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-codex-doc45-"));
    configPath = join(tempDir, "config.toml");
    originalBackupPath = join(tempDir, "codex_notify_original.json");
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------
  // §7.2 runtime command
  // -------------------------------------------------------------------
  describe("runtime resolution", () => {
    it("writes the injected runtime path when installing fresh", async () => {
      await writeFile(configPath, 'model = "gpt-5"\n', "utf8");
      await installCodexNotifier({
        configPath,
        notifyPath,
        originalBackupPath,
        runtimePath,
      });
      const updated = await readFile(configPath, "utf8");
      expect(updated).toContain(
        'notify = ["/usr/local/bin/node", "/tmp/pew/bin/notify.cjs", "--source=codex"]',
      );
      expect(updated).not.toContain("/usr/bin/env");
    });

    it("recognises legacy /usr/bin/env node as installed", async () => {
      await writeFile(
        configPath,
        'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
        "utf8",
      );
      const status = await getCodexNotifierStatus({
        configPath,
        notifyPath,
        originalBackupPath,
        runtimePath,
      });
      expect(status).toBe("installed");
    });

    it("recognises the new runtime-path variant as installed", async () => {
      await writeFile(
        configPath,
        'notify = ["/usr/local/bin/node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
        "utf8",
      );
      const status = await getCodexNotifierStatus({
        configPath,
        notifyPath,
        originalBackupPath,
        runtimePath,
      });
      expect(status).toBe("installed");
    });
  });

  // -------------------------------------------------------------------
  // §8 ownership conflict
  // -------------------------------------------------------------------
  describe("ownership conflict", () => {
    it("returns ownership_conflict when backup exists but top-level is not Pew-owned", async () => {
      // Simulate a state where a previous pew init stored a backup pointing
      // to A, then A took the notify slot back. Running `pew init` again
      // must not silently reclaim the slot with the stale backup — that's
      // the persistent cycle from Issue #318.
      await writeFile(
        configPath,
        'notify = ["/usr/bin/env", "node", "/other/wrapper.cjs", "--source=codex"]\n',
        "utf8",
      );
      await writeFile(
        originalBackupPath,
        JSON.stringify({
          notify: ["/usr/bin/env", "node", "/some/A/hook.cjs", "--source=codex"],
          capturedAt: "2026-01-01T00:00:00Z",
        }),
      );
      const result = await installCodexNotifier({
        configPath,
        notifyPath,
        originalBackupPath,
        runtimePath,
      });
      expect(result.changed).toBe(false);
      expect(result.action).toBe("skip");
      expect(result.detail).toMatch(/ownership_conflict|conflict/i);
      // Config must be untouched.
      const stillConfig = await readFile(configPath, "utf8");
      expect(stillConfig).toContain("/other/wrapper.cjs");
      // Backup must be preserved.
      const stillBackup = await readFile(originalBackupPath, "utf8");
      expect(stillBackup).toContain("/some/A/hook.cjs");
    });

    it("does NOT store a legacy Pew command as saved-original", async () => {
      // Existing notify already points at Pew via the legacy /usr/bin/env
      // form. `pew init` in the new-runtime mode migrates the command in
      // place; it must NOT capture the legacy command as saved-original
      // (self-backup would seed the Issue #318 cycle).
      await writeFile(
        configPath,
        'notify = ["/usr/bin/env", "node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
        "utf8",
      );
      const result = await installCodexNotifier({
        configPath,
        notifyPath,
        originalBackupPath,
        runtimePath,
      });
      // Migration should update the top-level command (or no-op if already
      // matches new form). Either way, no backup should be written.
      expect(result.changed).toBeDefined();
      await expect(readFile(originalBackupPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  // -------------------------------------------------------------------
  // §8 uninstall cycle validation
  // -------------------------------------------------------------------
  describe("uninstall cycle validation", () => {
    it("retains backup when the saved original points back at Pew notify.cjs", async () => {
      // notify.cjs installed, but backup contains a Pew-owned command
      // (indirect cycle). Uninstall must NOT restore this and must
      // preserve the backup for manual inspection.
      await writeFile(
        configPath,
        'notify = ["/usr/local/bin/node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
        "utf8",
      );
      await writeFile(
        originalBackupPath,
        JSON.stringify({
          notify: [
            "/usr/bin/env",
            "node",
            "/tmp/pew/bin/notify.cjs",
            "--source=codex",
          ],
          capturedAt: "2026-01-01T00:00:00Z",
        }),
      );
      const result = await uninstallCodexNotifier({
        configPath,
        notifyPath,
        originalBackupPath,
        runtimePath,
      });
      expect(result.warnings).toBeDefined();
      // Backup file must still exist for manual review.
      const stillBackup = await readFile(originalBackupPath, "utf8");
      expect(stillBackup).toContain("notify.cjs");
    });

    it("restores and removes backup on happy-path uninstall", async () => {
      await writeFile(
        configPath,
        'notify = ["/usr/local/bin/node", "/tmp/pew/bin/notify.cjs", "--source=codex"]\n',
        "utf8",
      );
      await writeFile(
        originalBackupPath,
        JSON.stringify({
          notify: ["/other/hook.cjs"],
          capturedAt: "2026-01-01T00:00:00Z",
        }),
      );
      const result = await uninstallCodexNotifier({
        configPath,
        notifyPath,
        originalBackupPath,
        runtimePath,
      });
      expect(result.changed).toBe(true);
      const updated = await readFile(configPath, "utf8");
      expect(updated).toContain("/other/hook.cjs");
      // Backup must be removed on happy-path.
      await expect(readFile(originalBackupPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});

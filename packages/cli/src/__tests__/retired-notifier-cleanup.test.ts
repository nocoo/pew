import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeNotify } from "../commands/notify.js";
import { executeUninstall } from "../commands/uninstall.js";
import { buildNotifyHandler, repairRetiredNotifyHandler } from "../notifier/notify-handler.js";
import { cleanupRetiredHooks } from "../notifier/retired-hook-cleanup.js";
import { resolveNotifierPaths } from "../notifier/paths.js";

describe("retired notifier handoff", () => {
  let home: string;
  let stateDir: string;
  let notifyPath: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "pew-retired-hooks-"));
    stateDir = join(home, ".config", "pew");
    notifyPath = join(stateDir, "bin", "notify.cjs");
    await mkdir(dirname(notifyPath), { recursive: true });
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("repairs an owned old dispatcher and consumes the already admitted shared window", async () => {
    const current = buildNotifyHandler({ stateDir, pewBin: "/synthetic/pew" });
    const old = current.replace(/^if \(\["gemini-cli".*process.exit\(0\);\n/m, "");
    await writeFile(notifyPath, old);
    const admitted: string[][] = [];
    for (const source of ["gemini-cli", "claude-code"]) {
      const exit = new Error("exit");
      const script = new vm.Script(old.replace(/^#!.*\n/, ""));
      try {
        script.runInNewContext({
          __filename: notifyPath,
          __pewNow: () => 1000,
          process: {
            argv: ["node", notifyPath, `--source=${source}`],
            env: {},
            platform: process.platform,
            exit: () => {
              throw exit;
            },
          },
          require: (name: string) => {
            if (name === "node:fs") return { ...nodeFs, existsSync: () => true };
            if (name === "node:path") return nodePath;
            if (name === "node:os") return { homedir: () => home };
            if (name === "node:child_process")
              return {
                spawn: (_cmd: string, args: string[]) => {
                  admitted.push(args);
                  return { unref: () => {} };
                },
              };
            throw new Error(name);
          },
        });
      } catch (error) {
        if (error !== exit) throw error;
      }
    }
    expect(admitted).toEqual([["notify", "--source=gemini-cli", "--not-before=2000"]]);
    const sync = vi.fn(async (trigger) => ({
      runId: "test",
      triggers: [trigger],
      cycles: [],
      hadFollowUp: false,
      followUpCount: 0,
      waitedForLock: false,
      skippedSync: false,
      degradedToUnlocked: false,
    }));
    await executeNotify({
      stateDir,
      deviceId: "test",
      source: "gemini-cli",
      notBefore: 2000,
      nowFn: () => 2000,
      coordinatedSyncFn: sync,
    });
    expect(sync).toHaveBeenCalledOnce();
    expect(await readFile(notifyPath, "utf8")).toBe(current);
  });

  it("rejects malformed or foreign dispatcher metadata and tolerates a missing dispatcher", async () => {
    await expect(repairRetiredNotifyHandler(stateDir)).resolves.toBe(false);
    for (const body of [
      "",
      'const PEW_BIN = "pew";',
      'const STATE_DIR = "elsewhere";\nconst PEW_BIN = "pew";',
      `const STATE_DIR = ${JSON.stringify(stateDir)};\nconst PEW_BIN = "";`,
      'const STATE_DIR = "\\uINVALID";\nconst PEW_BIN = "pew";',
    ]) {
      await writeFile(notifyPath, `#!/usr/bin/env node\n// PEW_NOTIFY_HANDLER\n${body}\n`);
      await expect(repairRetiredNotifyHandler(stateDir)).resolves.toBe(false);
    }
    const modified = `${buildNotifyHandler({ stateDir, pewBin: "/synthetic/pew" })}// user custom logic\n`;
    await writeFile(notifyPath, modified);
    await expect(repairRetiredNotifyHandler(stateDir)).resolves.toBe(false);
    expect(await readFile(notifyPath, "utf8")).toBe(modified);
  });

  it("preserves modified OMP extensions and the dispatcher they still call", async () => {
    const path = join(home, ".omp", "agent", "extensions", "pew-sync.ts");
    await mkdir(dirname(path), { recursive: true });
    const raw = `// PEW_OMP_HOOK\ncustom(${JSON.stringify(notifyPath)});`;
    await writeFile(path, raw);
    await writeFile(notifyPath, buildNotifyHandler({ stateDir, pewBin: "/synthetic/pew" }));
    const result = await executeUninstall({ stateDir, home, uninstallAllFn: async () => [] });
    expect(result.notifyHandler.changed).toBe(false);
    expect(await readFile(path, "utf8")).toBe(raw);
    await expect(access(notifyPath)).resolves.toBeUndefined();
  });

  it("removes only the exact old OMP extension and tolerates foreign unrelated files", async () => {
    const path = join(home, ".omp", "agent", "extensions", "pew-sync.ts");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "// user extension\n");
    expect(await cleanupRetiredHooks(home, notifyPath, {})).toEqual([]);
    await writeFile(
      path,
      `// PEW_OMP_HOOK \u2014 managed by pew, do not edit
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { spawn } from "node:child_process";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    try {
      const child = spawn("node", [${JSON.stringify(notifyPath)}, "--source=omp"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  });
}
`,
    );
    expect(await cleanupRetiredHooks(home, notifyPath, {})).toEqual([
      expect.objectContaining({ source: "omp", changed: true }),
    ]);
    await expect(access(path)).rejects.toThrow();
  });

  it("removes a sole exact Gemini hook in a custom home without creating settings", async () => {
    const root = join(home, "gemini custom");
    const path = join(root, "settings.json");
    await mkdir(root);
    const quotedPath = `"${notifyPath} with space"`;
    const command = `/usr/bin/env node ${quotedPath} --source=gemini-cli`;
    await writeFile(
      path,
      JSON.stringify({
        hooks: { SessionEnd: [{ hooks: [{ type: "command", command }] }] },
        other: 1,
      }),
    );
    await cleanupRetiredHooks(home, `${notifyPath} with space`, { GEMINI_HOME: ` ${root} ` });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ other: 1 });
  });

  it.each(["null", "[]", '{"hooks":[]}', '{"hooks":{"SessionEnd":false}}'])(
    "keeps unparseable hook settings (%s)",
    async (raw) => {
      const path = join(home, ".gemini", "settings.json");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, raw);
      expect(await cleanupRetiredHooks(home, notifyPath, {})).toEqual([
        expect.objectContaining({ changed: false, warnings: expect.any(Array) }),
      ]);
      expect(await readFile(path, "utf8")).toBe(raw);
    },
  );

  it("keeps modified Gemini commands that still reference the dispatcher", async () => {
    const path = join(home, ".gemini", "settings.json");
    await mkdir(dirname(path), { recursive: true });
    const raw = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: `node ${notifyPath} --source=gemini-cli` }] },
        ],
      },
    });
    await writeFile(path, raw);
    expect(await cleanupRetiredHooks(home, notifyPath, {})).toEqual([
      expect.objectContaining({ warnings: expect.any(Array) }),
    ]);
    expect(await readFile(path, "utf8")).toBe(raw);
  });

  it.each([
    ["omp", "C:\\Users\\test\\pew\\notify.cjs"],
    ["omp", '/home/test/pew"custom/notify.cjs'],
    ["gemini-cli", "C:\\Users\\test\\pew\\notify.cjs"],
    ["gemini-cli", '/home/test/pew"custom/notify.cjs'],
  ] as const)(
    "keeps the dispatcher for modified %s hooks with an escaped path (%s)",
    async (source, target) => {
      const path =
        source === "omp"
          ? join(home, ".omp", "agent", "extensions", "pew-sync.ts")
          : join(home, ".gemini", "settings.json");
      await mkdir(dirname(path), { recursive: true });
      const raw =
        source === "omp"
          ? `custom(${JSON.stringify(target)});\n`
          : JSON.stringify({
              hooks: {
                SessionEnd: [
                  {
                    hooks: [
                      {
                        type: "command",
                        command: `node "${target.replace(/"/g, '\\"')}" --source=gemini-cli`,
                      },
                    ],
                  },
                ],
              },
            });
      await writeFile(path, raw);
      const remove = vi.fn();
      const result = await executeUninstall({
        stateDir,
        home,
        env: {},
        uninstallAllFn: async () => [],
        removeNotifyHandlerFn: remove,
        resolveNotifierPathsFn: () => ({ ...resolveNotifierPaths(home, {}), notifyPath: target }),
      });
      expect(result.hooks).toContainEqual(
        expect.objectContaining({ source, changed: false, warnings: expect.any(Array) }),
      );
      expect(remove).not.toHaveBeenCalled();
      expect(result.notifyHandler.changed).toBe(false);
      expect(await readFile(path, "utf8")).toBe(raw);
    },
  );

  it("never replaces a foreign dispatcher or runs a retired manual notification", async () => {
    await writeFile(notifyPath, "// user owned\n");
    const sync = vi.fn();
    await executeNotify({
      stateDir,
      deviceId: "test",
      source: "omp",
      notBefore: 2000,
      coordinatedSyncFn: sync,
    });
    expect(sync).not.toHaveBeenCalled();
    expect(await readFile(notifyPath, "utf8")).toBe("// user owned\n");
  });

  it("full uninstall removes exact old Gemini hooks but preserves other hooks and settings", async () => {
    const path = join(home, ".gemini", "settings.json");
    await mkdir(dirname(path), { recursive: true });
    const owned = {
      name: "pew-tracker",
      type: "command",
      command: `/usr/bin/env node ${notifyPath} --source=gemini-cli`,
    };
    const foreign = { name: "pew-tracker", type: "command", command: "/custom/program" };
    await writeFile(
      path,
      JSON.stringify({
        tools: { enableHooks: true },
        hooks: { SessionEnd: [{ matcher: "*", hooks: [owned, foreign] }], Other: ["unchanged"] },
      }),
    );
    await writeFile(notifyPath, buildNotifyHandler({ stateDir, pewBin: "/synthetic/pew" }));
    await executeUninstall({ stateDir, home, uninstallAllFn: async () => [] });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      tools: { enableHooks: true },
      hooks: { SessionEnd: [{ matcher: "*", hooks: [foreign] }], Other: ["unchanged"] },
    });
    await expect(access(notifyPath)).rejects.toThrow();
  });

  it("keeps the dispatcher when old settings cannot safely be parsed", async () => {
    const path = join(home, ".gemini", "settings.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not-json");
    await writeFile(notifyPath, buildNotifyHandler({ stateDir, pewBin: "/synthetic/pew" }));
    const result = await executeUninstall({ stateDir, home, uninstallAllFn: async () => [] });
    expect(result.notifyHandler.changed).toBe(false);
    await expect(access(notifyPath)).resolves.toBeUndefined();
    expect(await readFile(path, "utf8")).toBe("not-json");
  });
});

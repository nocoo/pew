import { afterEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNotifyHandler,
  removeNotifyHandler,
  resolvePewBin,
  writeNotifyHandler,
} from "../notifier/notify-handler.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildNotifyHandler", () => {
  it("includes the PEW_NOTIFY_HANDLER marker", () => {
    const source = buildNotifyHandler({
      stateDir: "/tmp/pew",
      pewBin: "/tmp/bin/pew",
    });

    expect(source).toContain("PEW_NOTIFY_HANDLER");
  });

  it("bakes in the provided stateDir and pewBin", () => {
    const source = buildNotifyHandler({
      stateDir: "/tmp/pew",
      pewBin: "/tmp/bin/pew",
    });

    expect(source).toContain('const STATE_DIR = "/tmp/pew";');
    expect(source).toContain('const PEW_BIN = "/tmp/bin/pew";');
  });

  it("generates valid JavaScript", () => {
    const source = buildNotifyHandler({
      stateDir: "/tmp/pew",
      pewBin: "/tmp/bin/pew",
    });

    expect(
      () => new vm.Script(source.replace(/^#!.*\n/, "")),
    ).not.toThrow();
  });

  it("includes Codex original notify chaining", () => {
    const source = buildNotifyHandler({
      stateDir: "/tmp/pew",
      pewBin: "/tmp/bin/pew",
    });

    expect(source).toContain('if (source === "codex")');
    expect(source).toContain("codex_notify_original.json");
  });

  it("falls back to npx when the baked binary is missing", () => {
    const source = buildNotifyHandler({
      stateDir: "/tmp/pew",
      pewBin: "/tmp/bin/pew",
    });

    expect(source).toContain('const bin = existsSync(PEW_BIN) ? PEW_BIN : "npx";');
    expect(source).toContain('"@nocoo/pew"');
  });
});

describe("writeNotifyHandler", () => {
  it("creates the bin directory and writes the file on first install", async () => {
    const fs = {
      readFile: vi.fn(async () => {
        const err = new Error("missing") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
    };

    const result = await writeNotifyHandler({
      binDir: "/tmp/pew/bin",
      source: "// source",
      fs,
    });

    expect(fs.mkdir).toHaveBeenCalledWith("/tmp/pew/bin", { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith("/tmp/pew/bin/notify.cjs", "// source", "utf8");
    expect(result.changed).toBe(true);
    expect(result.path).toBe("/tmp/pew/bin/notify.cjs");
  });

  it("does not rewrite the file when the content matches", async () => {
    const fs = {
      readFile: vi.fn(async () => "// source"),
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
    };

    const result = await writeNotifyHandler({
      binDir: "/tmp/pew/bin",
      source: "// source",
      fs,
    });

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });

  it("creates a backup before overwriting changed content", async () => {
    const fs = {
      readFile: vi.fn(async () => "// old"),
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
    };

    const result = await writeNotifyHandler({
      binDir: "/tmp/pew/bin",
      source: "// new",
      fs,
      now: () => "2026-03-09T10:00:00.000Z",
    });

    expect(fs.writeFile).toHaveBeenNthCalledWith(
      1,
      "/tmp/pew/bin/notify.cjs.bak.2026-03-09T10-00-00-000Z",
      "// old",
      "utf8",
    );
    expect(fs.writeFile).toHaveBeenNthCalledWith(
      2,
      "/tmp/pew/bin/notify.cjs",
      "// new",
      "utf8",
    );
    expect(result.backupPath).toBe(
      "/tmp/pew/bin/notify.cjs.bak.2026-03-09T10-00-00-000Z",
    );
  });

  it("re-throws non-ENOENT errors from readFile", async () => {
    const fs = {
      readFile: vi.fn(async () => {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }),
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
    };

    await expect(
      writeNotifyHandler({
        binDir: "/tmp/pew/bin",
        source: "// source",
        fs,
      }),
    ).rejects.toThrow("EPERM");
  });
});

describe("removeNotifyHandler", () => {
  it("removes a generated notify.cjs file", async () => {
    const fs = {
      readFile: vi.fn(async () => "#!/usr/bin/env node\n// PEW_NOTIFY_HANDLER — Auto-generated\n"),
      unlink: vi.fn(async () => {}),
    };

    const result = await removeNotifyHandler({
      notifyPath: "/tmp/pew/bin/notify.cjs",
      fs,
    });

    expect(fs.unlink).toHaveBeenCalledWith("/tmp/pew/bin/notify.cjs");
    expect(result.changed).toBe(true);
    expect(result.detail).toContain("removed");
  });

  it("skips removal when notify.cjs is missing", async () => {
    const fs = {
      readFile: vi.fn(async () => {
        const err = new Error("missing") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
      unlink: vi.fn(async () => {}),
    };

    const result = await removeNotifyHandler({
      notifyPath: "/tmp/pew/bin/notify.cjs",
      fs,
    });

    expect(fs.unlink).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.detail).toContain("not found");
  });

  it("skips removal when notify.cjs does not match the pew marker", async () => {
    const fs = {
      readFile: vi.fn(async () => "#!/usr/bin/env node\n// user script\n"),
      unlink: vi.fn(async () => {}),
    };

    const result = await removeNotifyHandler({
      notifyPath: "/tmp/pew/bin/notify.cjs",
      fs,
    });

    expect(fs.unlink).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.warnings).toContain("File does not contain pew marker");
  });

  it("re-throws non-ENOENT readFile errors", async () => {
    const fs = {
      readFile: vi.fn(async () => {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }),
      unlink: vi.fn(async () => {}),
    };

    await expect(
      removeNotifyHandler({
        notifyPath: "/tmp/pew/bin/notify.cjs",
        fs,
      }),
    ).rejects.toThrow("permission denied");
  });
});

describe("resolvePewBin", () => {
  it("resolves the pew binary from PATH", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pew-bin-"));
    const binPath = join(tempDir, "pew");
    const prevPath = process.env.PATH;
    const prevArgv = process.argv.slice();

    try {
      await writeFile(binPath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(binPath, 0o755);

      process.env.PATH = `${tempDir}:${prevPath ?? ""}`;
      process.argv = [prevArgv[0] ?? "node", "/tmp/pew"];

      const resolved = await resolvePewBin();
      expect(resolved).toBe(binPath);
    } finally {
      process.argv = prevArgv;
      process.env.PATH = prevPath;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers the sibling pew binary next to argv[1]", async () => {
    const prevArgv = process.argv.slice();
    const tempDir = await mkdtemp(join(tmpdir(), "pew-argv-bin-"));
    const binDir = join(tempDir, "bin");
    const argvEntry = join(binDir, "entry.js");
    const siblingPew = join(binDir, "pew");

    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(argvEntry, "", "utf8");
      await writeFile(siblingPew, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(siblingPew, 0o755);
      process.argv = ["bun", argvEntry];

      await expect(resolvePewBin()).resolves.toBe(siblingPew);
    } finally {
      process.argv = prevArgv;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when no argv sibling or PATH binary is executable", async () => {
    const prevArgv = process.argv.slice();
    const prevPath = process.env.PATH;
    const tempDir = await mkdtemp(join(tmpdir(), "pew-missing-bin-"));

    try {
      process.argv = ["bun", join(tempDir, "missing-entry.js")];
      process.env.PATH = tempDir;

      await expect(resolvePewBin()).rejects.toThrow("Unable to resolve pew binary");
    } finally {
      process.argv = prevArgv;
      process.env.PATH = prevPath;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("win32", () => {
    it("uses where.exe instead of which on win32", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pew-win-"));
      const binPath = join(tempDir, "pew.cmd");
      const prevArgv = process.argv.slice();

      try {
        // Create a pew.cmd file so fileExists() passes
        await writeFile(binPath, "@echo off\n", "utf8");

        // argv[1] points to nonexistent dir so sibling lookup fails
        process.argv = ["node", join(tempDir, "nonexistent", "entry.js")];

        const mockExecFile = vi.fn().mockResolvedValue({ stdout: binPath + "\n", stderr: "" });

        const resolved = await resolvePewBin({ platform: "win32", execFile: mockExecFile });

        // Should have called where.exe, NOT which
        expect(mockExecFile).toHaveBeenCalledWith("where.exe", ["pew"]);
        expect(resolved).toBe(binPath);
      } finally {
        process.argv = prevArgv;
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("resolves sibling pew.cmd on win32 when pew is absent", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pew-win-sibling-"));
      const binDir = join(tempDir, "bin");
      const argvEntry = join(binDir, "entry.js");
      const siblingCmd = join(binDir, "pew.cmd");
      const prevArgv = process.argv.slice();

      try {
        await mkdir(binDir, { recursive: true });
        await writeFile(argvEntry, "", "utf8");
        // Only pew.cmd exists, no pew (unix binary)
        await writeFile(siblingCmd, "@echo off\n", "utf8");
        process.argv = ["node", argvEntry];

        const resolved = await resolvePewBin({ platform: "win32" });
        expect(resolved).toBe(siblingCmd);
      } finally {
        process.argv = prevArgv;
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("picks first line from where.exe output on win32", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "pew-win-multi-"));
      const binPath = join(tempDir, "pew.cmd");
      const prevArgv = process.argv.slice();

      try {
        await writeFile(binPath, "@echo off\n", "utf8");
        process.argv = ["node", join(tempDir, "nonexistent", "entry.js")];

        // where.exe can return multiple lines
        const mockExecFile = vi.fn().mockResolvedValue({
          stdout: `${binPath}\nC:\\Other\\pew.cmd\n`,
          stderr: "",
        });

        const resolved = await resolvePewBin({ platform: "win32", execFile: mockExecFile });
        expect(resolved).toBe(binPath);
      } finally {
        process.argv = prevArgv;
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});

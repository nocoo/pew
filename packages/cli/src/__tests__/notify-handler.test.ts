import { describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { buildNotifyHandler, writeNotifyHandler } from "../notifier/notify-handler.js";

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
});

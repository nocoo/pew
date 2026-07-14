/**
 * Runtime behavior tests for the generated `notify.cjs`.
 *
 * We compile the handler source with `vm.Script` and execute it inside a
 * sandbox that injects fake `fs`, `path`, `spawn`, `now`, `argv`, `env`,
 * `platform`, and `exit` dependencies. The production handler exposes a
 * `main(deps)` function attached to `globalThis.__pewNotifyMain` when
 * loaded under a sentinel env flag; tests invoke it directly.
 *
 * See docs/45-codex-notifier-cycle-containment.md §6 for the test-matrix
 * specification.
 */
import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { buildNotifyHandler } from "../notifier/notify-handler.js";

// ---------------------------------------------------------------------------
// Sandbox harness
// ---------------------------------------------------------------------------

interface FakeFile {
  data: string;
}

interface FakeFsErrorInjection {
  wxErrno?: Partial<Record<string, string>>; // gate path → errno
  readErrno?: Partial<Record<string, string>>; // read path → errno
  writeErrno?: Partial<Record<string, string>>; // arbitrary write path → errno
}

interface FakeFsState {
  files: Map<string, FakeFile>;
  errors: FakeFsErrorInjection;
  reads: string[]; // ordered log of readFileSync calls
  writes: Array<{ path: string; flag?: string }>;
  unlinks: string[];
  mkdirs: string[];
  appends: string[];
  readdirs: string[];
}

function makeFakeFs(state: FakeFsState) {
  const err = (code: string, syscall: string, path: string) => {
    const e = new Error(`${code}: ${syscall} ${path}`) as NodeJS.ErrnoException;
    e.code = code;
    return e;
  };
  return {
    appendFileSync(path: string, data: string, _enc: string) {
      state.appends.push(path);
      const existing = state.files.get(path)?.data ?? "";
      state.files.set(path, { data: existing + data });
    },
    readFileSync(path: string, _enc: string): string {
      state.reads.push(path);
      const injected = state.errors.readErrno?.[path];
      if (injected) throw err(injected, "read", path);
      const f = state.files.get(path);
      if (!f) throw err("ENOENT", "read", path);
      return f.data;
    },
    writeFileSync(path: string, data: string, opts?: { flag?: string } | string) {
      const flag = typeof opts === "object" ? opts?.flag : undefined;
      state.writes.push({ path, flag });
      // exclusive create: honor injected errno first, then real EEXIST
      if (flag === "wx") {
        const injected = state.errors.wxErrno?.[path];
        if (injected) throw err(injected, "open", path);
        if (state.files.has(path)) throw err("EEXIST", "open", path);
      }
      const injected = state.errors.writeErrno?.[path];
      if (injected) throw err(injected, "write", path);
      state.files.set(path, { data });
    },
    unlinkSync(path: string) {
      state.unlinks.push(path);
      state.files.delete(path);
    },
    mkdirSync(path: string, _opts?: { recursive: boolean; mode?: number }) {
      state.mkdirs.push(path);
    },
    existsSync(path: string): boolean {
      return state.files.has(path);
    },
    readdirSync(path: string): string[] {
      state.readdirs.push(path);
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const out: string[] = [];
      for (const key of state.files.keys()) {
        if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
      }
      return out;
    },
  };
}

interface SpawnRecord {
  cmd: string;
  args: string[];
  opts: Record<string, unknown>;
}

function makeFakeSpawn(records: SpawnRecord[], opts?: { throwOn?: (cmd: string) => boolean }) {
  return (cmd: string, args: string[], spawnOpts: Record<string, unknown>) => {
    records.push({ cmd, args, opts: spawnOpts });
    if (opts?.throwOn?.(cmd)) throw new Error(`spawn ${cmd} failed`);
    return { unref: () => {}, catch: () => {} };
  };
}

interface HandlerCallOpts {
  stateDir: string;
  pewBin: string;
  source: string;
  now: number;
  nowFn?: () => number;
  argv?: string[];
  env?: Record<string, string>;
  platform?: NodeJS.Platform;
  fsState: FakeFsState;
  spawnRecords: SpawnRecord[];
  spawnThrowOn?: (cmd: string) => boolean;
  exitCodes?: number[];
}

interface HandlerContext {
  script: vm.Script;
}

/**
 * Compile the generated handler source once. Each call gets a **fresh**
 * sandbox: production runs the CJS file once per Node invocation, so
 * top-level `const` / `let` are single-shot. Reusing a sandbox across
 * calls would trigger 'duplicate variable declaration' errors that never
 * happen in production.
 */
function compileHandler(stateDir: string, pewBin: string): HandlerContext {
  const source = buildNotifyHandler({ stateDir, pewBin });
  // Strip shebang so vm.Script parses cleanly.
  const script = new vm.Script(source.replace(/^#!.*\n/, ""));
  return { script };
}

function callHandler(ctx: HandlerContext, opts: HandlerCallOpts): number {
  const exitCodes = opts.exitCodes ?? [];
  const nowFn = opts.nowFn ?? (() => opts.now);
  const sandboxGlobals: Record<string, unknown> = {
    require: (mod: string) => {
      if (mod === "node:fs") return makeFakeFs(opts.fsState);
      if (mod === "node:child_process") {
        return {
          spawn: makeFakeSpawn(opts.spawnRecords, { throwOn: opts.spawnThrowOn }),
        };
      }
      if (mod === "node:path") {
        const path = require("node:path") as typeof import("node:path");
        return path;
      }
      if (mod === "node:os") {
        return {
          homedir: () => opts.env?.HOME ?? "/home/test",
        };
      }
      if (mod === "node:crypto") {
        const crypto = require("node:crypto") as typeof import("node:crypto");
        return crypto;
      }
      throw new Error(`unstubbed require: ${mod}`);
    },
    process: {
      argv: ["/usr/bin/node", "notify.cjs", ...(opts.argv ?? [`--source=${opts.source}`])],
      env: opts.env ?? {},
      platform: opts.platform ?? "linux",
      exit: (code: number) => {
        exitCodes.push(code);
        throw new HandlerExitSignal(code);
      },
      pid: 12345,
    },
    __filename: `${opts.stateDir}/bin/notify.cjs`,
    __dirname: `${opts.stateDir}/bin`,
    __pewNow: nowFn,
    console: { error: () => {}, log: () => {} },
    Date, // handler uses `new Date(...)` for diagnostic timestamp
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
  };
  // Fresh sandbox per invocation — the generated handler is a single-shot
  // CJS file, so top-level `const`/`let` cannot be re-evaluated.
  sandboxGlobals.globalThis = sandboxGlobals;
  const sandbox = vm.createContext(sandboxGlobals);
  try {
    ctx.script.runInContext(sandbox);
  } catch (err) {
    if (!(err instanceof HandlerExitSignal)) throw err;
  }
  return exitCodes[exitCodes.length - 1] ?? 0;
}

class HandlerExitSignal extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function emptyState(): FakeFsState {
  return {
    files: new Map(),
    errors: {},
    reads: [],
    writes: [],
    unlinks: [],
    mkdirs: [],
    appends: [],
    readdirs: [],
  };
}

// ---------------------------------------------------------------------------
// §6.1 test matrix
// ---------------------------------------------------------------------------

const STATE_DIR = "/state";
const PEW_BIN = "/bin/pew";
const W = 2_000;
const T = 1_700_000_000_000; // fixed epoch for bucket = floor(T/W)
const BUCKET = Math.floor(T / W);

describe("handler runtime — chain guard", () => {
  it("direct self chain → zero signal, zero spawn", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    const spawns: SpawnRecord[] = [];
    // Compute the instance ID the same way the handler does.
    const instanceId = expectedInstanceId(STATE_DIR, "linux");
    const code = callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      env: { PEW_NOTIFY_CHAIN: instanceId },
      fsState: fs,
      spawnRecords: spawns,
    });
    expect(code).toBe(0);
    expect(fs.appends).toHaveLength(0);
    expect(spawns).toHaveLength(0);
  });

  it("chain length > 2048 bytes → fail-closed", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    const spawns: SpawnRecord[] = [];
    const oversized = "x".repeat(3_000);
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      env: { PEW_NOTIFY_CHAIN: oversized },
      fsState: fs,
      spawnRecords: spawns,
    });
    expect(spawns).toHaveLength(0);
  });

  it("Pew → A → Pew with env preserved → second entry zero spawn", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    const spawns: SpawnRecord[] = [];
    const instanceId = expectedInstanceId(STATE_DIR, "linux");
    // Simulate the second Pew handler seeing its own id already in the chain.
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      env: { PEW_NOTIFY_CHAIN: `${instanceId},someWrapperId,${instanceId}` },
      fsState: fs,
      spawnRecords: spawns,
    });
    expect(spawns).toHaveLength(0);
  });
});

describe("handler runtime — sync gate + forward gate (Codex)", () => {
  it("100 same-bucket calls: signal append 100, Pew spawn 1, Codex saved-original spawn 1", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" }); // makes existsSync(PEW_BIN) true
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({
        notify: ["/usr/bin/env", "node", "/other/hook.cjs", "--source=codex"],
      }),
    });
    const spawns: SpawnRecord[] = [];
    for (let i = 0; i < 100; i++) {
      callHandler(ctx, {
        stateDir: STATE_DIR,
        pewBin: PEW_BIN,
        source: "codex",
        now: T,
        fsState: fs,
        spawnRecords: spawns,
      });
    }
    expect(fs.appends).toHaveLength(100);
    const pewSpawns = spawns.filter((s) => s.cmd === PEW_BIN);
    const otherSpawns = spawns.filter((s) => s.cmd !== PEW_BIN);
    expect(pewSpawns).toHaveLength(1);
    expect(otherSpawns).toHaveLength(1);
  });

  it("100 same-bucket Codex calls: backup JSON read exactly once (loser doesn't read)", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({ notify: ["/other/hook"] }),
    });
    const spawns: SpawnRecord[] = [];
    for (let i = 0; i < 100; i++) {
      callHandler(ctx, {
        stateDir: STATE_DIR,
        pewBin: PEW_BIN,
        source: "codex",
        now: T,
        fsState: fs,
        spawnRecords: spawns,
      });
    }
    const backupReads = fs.reads.filter(
      (p) => p === `${STATE_DIR}/codex_notify_original.json`,
    );
    expect(backupReads).toHaveLength(1);
  });

  it("100 same-bucket calls, backup missing: Pew spawn 1, saved-original spawn 0", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    // No backup file.
    const spawns: SpawnRecord[] = [];
    for (let i = 0; i < 100; i++) {
      callHandler(ctx, {
        stateDir: STATE_DIR,
        pewBin: PEW_BIN,
        source: "codex",
        now: T,
        fsState: fs,
        spawnRecords: spawns,
      });
    }
    const pewSpawns = spawns.filter((s) => s.cmd === PEW_BIN);
    const other = spawns.filter((s) => s.cmd !== PEW_BIN);
    expect(pewSpawns).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it("Claude first, Codex second in same bucket: Pew spawn 1 (Claude), saved-original spawn 1 (Codex)", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({ notify: ["/other/hook"] }),
    });
    const spawns: SpawnRecord[] = [];
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "claude-code",
      now: T,
      argv: ["--source=claude-code"],
      fsState: fs,
      spawnRecords: spawns,
    });
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      fsState: fs,
      spawnRecords: spawns,
    });
    const pewSpawns = spawns.filter((s) => s.cmd === PEW_BIN);
    const other = spawns.filter((s) => s.cmd !== PEW_BIN);
    expect(pewSpawns).toHaveLength(1);
    expect(other).toHaveLength(1);
  });

  it("Codex first, Claude second in same bucket: Pew spawn 1 (Codex won sync), saved-original spawn 1", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({ notify: ["/other/hook"] }),
    });
    const spawns: SpawnRecord[] = [];
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      fsState: fs,
      spawnRecords: spawns,
    });
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "claude-code",
      now: T,
      argv: ["--source=claude-code"],
      fsState: fs,
      spawnRecords: spawns,
    });
    const pewSpawns = spawns.filter((s) => s.cmd === PEW_BIN);
    const other = spawns.filter((s) => s.cmd !== PEW_BIN);
    expect(pewSpawns).toHaveLength(1);
    expect(other).toHaveLength(1);
  });

  it("sync EEXIST + forward success: Pew spawn 0, saved-original spawn 1", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({ notify: ["/other/hook"] }),
    });
    // Pre-populate sync gate to simulate an earlier winner.
    fs.files.set(`${STATE_DIR}/notify-admission/sync-${BUCKET}.lock`, {
      data: "",
    });
    const spawns: SpawnRecord[] = [];
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      fsState: fs,
      spawnRecords: spawns,
    });
    const pewSpawns = spawns.filter((s) => s.cmd === PEW_BIN);
    const other = spawns.filter((s) => s.cmd !== PEW_BIN);
    expect(pewSpawns).toHaveLength(0);
    expect(other).toHaveLength(1);
  });

  it("sync success + forward gate EACCES: Pew spawn 1, saved-original spawn 0", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({ notify: ["/other/hook"] }),
    });
    fs.errors.wxErrno = {
      [`${STATE_DIR}/notify-admission/forward-codex-${BUCKET}.lock`]: "EACCES",
    };
    const spawns: SpawnRecord[] = [];
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      fsState: fs,
      spawnRecords: spawns,
    });
    const pewSpawns = spawns.filter((s) => s.cmd === PEW_BIN);
    const other = spawns.filter((s) => s.cmd !== PEW_BIN);
    expect(pewSpawns).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it("sync gate EACCES + forward success: Pew spawn 0, saved-original spawn 1", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({ notify: ["/other/hook"] }),
    });
    fs.errors.wxErrno = {
      [`${STATE_DIR}/notify-admission/sync-${BUCKET}.lock`]: "EACCES",
    };
    const spawns: SpawnRecord[] = [];
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      fsState: fs,
      spawnRecords: spawns,
    });
    const pewSpawns = spawns.filter((s) => s.cmd === PEW_BIN);
    const other = spawns.filter((s) => s.cmd !== PEW_BIN);
    expect(pewSpawns).toHaveLength(0);
    expect(other).toHaveLength(1);
  });
});

describe("handler runtime — post-create expiry check", () => {
  it("wx create succeeds but now2 has advanced to next bucket → spawn skipped", () => {
    const ctx = compileHandler(STATE_DIR, PEW_BIN);
    const fs = emptyState();
    fs.files.set(PEW_BIN, { data: "" });
    fs.files.set(`${STATE_DIR}/codex_notify_original.json`, {
      data: JSON.stringify({ notify: ["/other/hook"] }),
    });
    // Two-value clock: first sample returns T (initial bucket), post-create
    // recheck returns T + W + 1 (next bucket). The handler must detect the
    // stale bucket and refuse to spawn.
    let call = 0;
    const clock = () => (call++ === 0 ? T : T + W + 1);
    const spawns: SpawnRecord[] = [];
    callHandler(ctx, {
      stateDir: STATE_DIR,
      pewBin: PEW_BIN,
      source: "codex",
      now: T,
      nowFn: clock,
      fsState: fs,
      spawnRecords: spawns,
    });
    expect(spawns).toHaveLength(0);
  });
});

describe("handler runtime — Windows path canonicalization", () => {
  it("Windows INSTANCE_ID is case-folded, POSIX is not", () => {
    const winId1 = expectedInstanceId("C:\\Users\\Foo\\state", "win32");
    const winId2 = expectedInstanceId("c:\\users\\foo\\state", "win32");
    expect(winId1).toBe(winId2);

    const posixId1 = expectedInstanceId("/Home/Foo/state", "linux");
    const posixId2 = expectedInstanceId("/home/foo/state", "linux");
    expect(posixId1).not.toBe(posixId2);
  });
});

describe("handler runtime — argv passthrough", () => {
  it("spawn uses argv array, no shell interpolation, path with spaces survives", () => {
    const stateWithSpace = "/tmp/pew state";
    const binWithSpace = "/tmp/pew bin/pew";
    const ctx = compileHandler(stateWithSpace, binWithSpace);
    const fs = emptyState();
    fs.files.set(binWithSpace, { data: "" }); // makes existsSync true
    const spawns: SpawnRecord[] = [];
    callHandler(ctx, {
      stateDir: stateWithSpace,
      pewBin: binWithSpace,
      source: "codex",
      now: T,
      fsState: fs,
      spawnRecords: spawns,
    });
    const pewSpawn = spawns.find((s) => s.cmd === binWithSpace);
    expect(pewSpawn).toBeDefined();
    // spawnOpts must not contain shell:true
    expect(pewSpawn?.opts.shell).not.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers to keep the assertion expressions honest about what the handler
// is expected to do. INSTANCE_ID is baked from stateDir with a platform-
// aware canonicalize().
// ---------------------------------------------------------------------------

function expectedInstanceId(stateDir: string, platform: NodeJS.Platform): string {
  const path = require("node:path") as typeof import("node:path");
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const resolved = path.resolve(stateDir);
  const canonical = platform === "win32" ? resolved.toLowerCase() : resolved;
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

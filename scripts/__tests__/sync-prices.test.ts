import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { runSync, parseArgs, main } from "../sync-prices";

const FIXTURE_DIR = resolve(__dirname, "fixtures");
const NOW = "2026-04-30T00:00:00.000Z";

function tempFile(): string {
  const d = resolve(tmpdir(), `pew-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return resolve(d, "model-prices.json");
}

describe("runSync", () => {
  let outputPath: string;

  beforeEach(() => {
    outputPath = tempFile();
  });

  afterEach(() => {
    try {
      rmSync(resolve(outputPath, ".."), { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("fixture mode produces deterministic output", async () => {
    const r1 = await runSync({
      dryRun: true,
      allowRemovals: false,
      fixtureDir: FIXTURE_DIR,
      outputPath,
      now: NOW,
    });
    const r2 = await runSync({
      dryRun: true,
      allowRemovals: false,
      fixtureDir: FIXTURE_DIR,
      outputPath,
      now: NOW,
    });
    expect(r1.entries).toEqual(r2.entries);
    expect(r1.entries.length).toBeGreaterThan(0);
  });

  it("first-run with no prior baseline produces entries", async () => {
    const r = await runSync({
      dryRun: false,
      allowRemovals: false,
      fixtureDir: FIXTURE_DIR,
      outputPath,
      now: NOW,
    });
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.removedModels).toEqual([]);
  });

  it("regression check reports removedModels when prior baseline has extras", async () => {
    writeFileSync(
      outputPath,
      JSON.stringify(
        [
          {
            model: "deprecated/model",
            provider: "Test",
            displayName: null,
            inputPerMillion: 1,
            outputPerMillion: 2,
            cachedPerMillion: null,
            contextWindow: null,
            origin: "baseline",
            updatedAt: NOW,
          },
        ],
        null,
        2
      ) + "\n"
    );
    const r = await runSync({
      dryRun: true,
      allowRemovals: false,
      fixtureDir: FIXTURE_DIR,
      outputPath,
      now: NOW,
    });
    expect(r.removedModels).toContain("deprecated/model");
  });

  it("warnings from parsers propagate", async () => {
    // Use a fixture dir with a broken openrouter to trigger warnings.
    const dir = resolve(tmpdir(), `pew-fxt-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "openrouter.json"),
      JSON.stringify({ data: [{ id: "broken", pricing: { prompt: "abc", completion: "1" } }] })
    );
    writeFileSync(
      resolve(dir, "models-dev.json"),
      JSON.stringify({})
    );
    const r = await runSync({
      dryRun: true,
      allowRemovals: false,
      fixtureDir: dir,
      outputPath,
      now: NOW,
    });
    expect(r.warnings.some((w) => w.includes("broken"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("parseArgs", () => {
  it("parses --dry-run + --fixture", () => {
    const a = parseArgs(["--dry-run", "--fixture", "/tmp/x"]);
    expect(a.dryRun).toBe(true);
    expect(a.fixtureDir).toBe("/tmp/x");
  });

  it("requires fixture argument", () => {
    expect(() => parseArgs(["--fixture"])).toThrow(/requires/);
  });

  it("parses --allow-removals", () => {
    expect(parseArgs(["--allow-removals"]).allowRemovals).toBe(true);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown/);
  });
});

describe("main (dry-run path)", () => {
  it("dry-run does not write file", async () => {
    const out = tempFile();
    rmSync(out, { force: true });
    const code = await main(["--dry-run", "--fixture", FIXTURE_DIR, "--output", out]);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(false);
    rmSync(resolve(out, ".."), { recursive: true, force: true });
  });

  it("regression failure returns exit 2 without --allow-removals", async () => {
    const out = tempFile();
    writeFileSync(
      out,
      JSON.stringify(
        [
          {
            model: "ghost/model",
            provider: "Test",
            displayName: null,
            inputPerMillion: 1,
            outputPerMillion: 2,
            cachedPerMillion: null,
            contextWindow: null,
            origin: "baseline",
            updatedAt: NOW,
          },
        ],
        null,
        2
      ) + "\n"
    );
    const code = await main(["--dry-run", "--fixture", FIXTURE_DIR, "--output", out]);
    expect(code).toBe(2);
    rmSync(resolve(out, ".."), { recursive: true, force: true });
  });

  it("--allow-removals lets removals through with REMOVED: lines", async () => {
    const out = tempFile();
    writeFileSync(
      out,
      JSON.stringify(
        [
          {
            model: "ghost/model",
            provider: "Test",
            displayName: null,
            inputPerMillion: 1,
            outputPerMillion: 2,
            cachedPerMillion: null,
            contextWindow: null,
            origin: "baseline",
            updatedAt: NOW,
          },
        ],
        null,
        2
      ) + "\n"
    );
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      const code = await main([
        "--dry-run",
        "--allow-removals",
        "--fixture",
        FIXTURE_DIR,
        "--output",
        out,
      ]);
      expect(code).toBe(0);
      expect(logs.some((l) => l.startsWith("REMOVED: ghost/model"))).toBe(true);
    } finally {
      console.log = origLog;
      rmSync(resolve(out, ".."), { recursive: true, force: true });
    }
  });

  it("write path produces zero diff on re-run with same fixtures", async () => {
    const out = tempFile();
    rmSync(out, { force: true });
    let code = await main(["--fixture", FIXTURE_DIR, "--output", out]);
    expect(code).toBe(0);
    const first = readFileSync(out, "utf-8");
    code = await main(["--fixture", FIXTURE_DIR, "--output", out]);
    expect(code).toBe(0);
    const second = readFileSync(out, "utf-8");
    expect(second).toBe(first);
    rmSync(resolve(out, ".."), { recursive: true, force: true });
  });

  it("default output: dry-run against committed baseline exits 0 (acceptance smoke)", async () => {
    // No --output flag → uses the committed packages/worker-read/src/data/model-prices.json.
    // The fixtures must cover every legacy model id, otherwise removal guard fires.
    const code = await main(["--dry-run", "--fixture", FIXTURE_DIR]);
    expect(code).toBe(0);
  });
});

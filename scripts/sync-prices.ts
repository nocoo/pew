#!/usr/bin/env bun
/**
 * sync-prices — fetch OpenRouter + models.dev, merge with prior baseline,
 * write packages/worker-read/src/data/model-prices.json.
 *
 * This is the developer-facing one-shot baseline refresh. Both upstreams must
 * succeed; partial output would silently bake an incomplete picture into the
 * checked-in file. (The runtime cron path in C3 takes the opposite stance.)
 *
 * Usage:
 *   bun run sync-prices
 *   bun run sync-prices --dry-run
 *   bun run sync-prices --allow-removals
 *   bun run sync-prices --fixture <dir>
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import {
  parseModelsDev,
  type ParseResult as ModelsDevParse,
} from "../packages/worker-read/src/sync/models-dev";
import {
  parseOpenRouter,
  type ParseResult as OpenRouterParse,
} from "../packages/worker-read/src/sync/openrouter";
import { mergePricingSources } from "../packages/worker-read/src/sync/merge";
import type {
  DynamicPricingEntry,
  DynamicPricingMeta,
} from "../packages/worker-read/src/sync/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const MODELS_DEV_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT = resolve(
  __dirname,
  "../packages/worker-read/src/data/model-prices.json"
);

export interface SyncOptions {
  dryRun: boolean;
  allowRemovals: boolean;
  fixtureDir: string | null;
  outputPath: string;
  now: string;
}

export interface SyncResult {
  entries: DynamicPricingEntry[];
  meta: Omit<DynamicPricingMeta, "lastErrors">;
  warnings: string[];
  removedModels: string[];
}

async function loadJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function loadFixture(dir: string, name: string): unknown {
  const file = resolve(dir, name);
  if (!existsSync(file)) throw new Error(`fixture missing: ${file}`);
  return JSON.parse(readFileSync(file, "utf-8"));
}

function loadPriorBaseline(path: string): DynamicPricingEntry[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as DynamicPricingEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error(`failed to read prior baseline ${path}: ${(err as Error).message}`);
    return [];
  }
}

export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  let openRouterJson: unknown;
  let modelsDevJson: unknown;

  if (opts.fixtureDir) {
    openRouterJson = loadFixture(opts.fixtureDir, "openrouter.json");
    modelsDevJson = loadFixture(opts.fixtureDir, "models-dev.json");
  } else {
    [openRouterJson, modelsDevJson] = await Promise.all([
      loadJson(OPENROUTER_URL),
      loadJson(MODELS_DEV_URL),
    ]);
  }

  const orParse: OpenRouterParse = parseOpenRouter(openRouterJson, opts.now);
  const mdParse: ModelsDevParse = parseModelsDev(modelsDevJson, opts.now);

  const prior = loadPriorBaseline(opts.outputPath);
  const merged = mergePricingSources({
    baseline: prior,
    openRouter: orParse.entries,
    modelsDev: mdParse.entries,
    admin: [],
    now: opts.now,
  });

  // Regression signal: any prior model not seen in either upstream this run.
  // Compares against upstream IDs (not merged output) so the baseline floor
  // doesn't mask upstream churn. Alias-aware: a prior bare ID is "covered"
  // when some upstream `provider/X` has X === priorId, since merge would
  // alias-expand it to the bare name.
  const upstreamIds = new Set<string>();
  const upstreamSuffixes = new Set<string>();
  for (const e of [...orParse.entries, ...mdParse.entries]) {
    upstreamIds.add(e.model);
    const slash = e.model.indexOf("/");
    if (slash >= 0) upstreamSuffixes.add(e.model.slice(slash + 1));
  }
  const removedModels = prior
    .map((e) => e.model)
    .filter((id) => !upstreamIds.has(id) && !upstreamSuffixes.has(id))
    .sort();

  // Preserve prior updatedAt when nothing meaningful changed — keeps re-runs
  // diff-free against the checked-in baseline file.
  const priorById = new Map(prior.map((e) => [e.model, e]));
  const stabilized = merged.entries.map((e) => {
    const prev = priorById.get(e.model);
    if (!prev) return e;
    if (
      prev.inputPerMillion === e.inputPerMillion &&
      prev.outputPerMillion === e.outputPerMillion &&
      prev.cachedPerMillion === e.cachedPerMillion &&
      prev.contextWindow === e.contextWindow &&
      prev.displayName === e.displayName &&
      prev.provider === e.provider &&
      prev.origin === e.origin &&
      JSON.stringify(prev.aliases ?? null) === JSON.stringify(e.aliases ?? null)
    ) {
      return { ...e, updatedAt: prev.updatedAt };
    }
    return e;
  });

  return {
    entries: stabilized,
    meta: merged.meta,
    warnings: [...orParse.warnings, ...mdParse.warnings, ...merged.warnings],
    removedModels,
  };
}

interface CliArgs {
  dryRun: boolean;
  allowRemovals: boolean;
  fixtureDir: string | null;
  outputPath: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    dryRun: false,
    allowRemovals: false,
    fixtureDir: null,
    outputPath: DEFAULT_OUTPUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--allow-removals":
        out.allowRemovals = true;
        break;
      case "--fixture":
        out.fixtureDir = argv[++i] ?? null;
        if (!out.fixtureDir) throw new Error("--fixture requires a directory argument");
        break;
      case "--output":
        out.outputPath = argv[++i] ?? out.outputPath;
        break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const now = new Date().toISOString();
  let result: SyncResult;
  try {
    result = await runSync({ ...args, now });
  } catch (err) {
    console.error(`fetch/parse failed: ${(err as Error).message}`);
    return 1;
  }
  if (result.entries.length === 0) {
    console.error("produced 0 entries — refusing to write");
    return 1;
  }

  if (result.removedModels.length > 0) {
    if (!args.allowRemovals) {
      console.error(
        `regression: ${result.removedModels.length} model(s) removed — pass --allow-removals to accept:`
      );
      for (const id of result.removedModels) console.error(`  - ${id}`);
      return 2;
    }
    for (const id of result.removedModels) console.log(`REMOVED: ${id}`);
  }

  for (const w of result.warnings) console.warn(`warn: ${w}`);
  console.log(
    `entries=${result.entries.length} baseline=${result.meta.baselineCount} openrouter=${result.meta.openRouterCount} modelsDev=${result.meta.modelsDevCount}`
  );

  if (args.dryRun) {
    console.log("dry-run: not writing");
    return 0;
  }

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(
    args.outputPath,
    JSON.stringify(result.entries, null, 2) + "\n",
    "utf-8"
  );
  console.log(`wrote ${args.outputPath}`);
  return 0;
}

const isDirectRun = import.meta.main ?? import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

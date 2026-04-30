/**
 * Orchestrates one full dynamic-pricing sync run on the worker side.
 *
 * Single entry point used by both the cron handler (C3) and the admin
 * rebuild endpoint (C6) — composing them through the same function avoids
 * silent drift between manual and scheduled refreshes.
 *
 * Partial-success policy (intentionally distinct from C2's all-or-nothing
 * baseline-refresh CLI):
 *   - Each upstream is fetched independently with a 20 s timeout.
 *   - On success → fresh JSON is used and immediately cached via
 *     writeLastFetch so a future failure can fall back to it.
 *   - On failure → fall back to the source's `pricing:last-fetch:*` if any.
 *     Push a {source, message} entry into errors regardless.
 *   - On failure with no cache → feed [] for that source into merge; the
 *     bundled baseline still floors the output.
 *
 * KV write is best-effort and logged; merged entries are still returned to
 * the caller even if KV writes fail — that's what the SyncOutcome carries.
 */

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

import baseline from "../data/model-prices.json";
import { mergePricingSources } from "./merge";
import { parseModelsDev } from "./models-dev";
import { parseOpenRouter } from "./openrouter";
import { loadAdminRows } from "./admin-loader";
import type { AdminPricingRow } from "./types";
import {
  readLastFetch,
  writeDynamic,
  writeLastFetch,
  writeMeta,
  type LastFetchSource,
} from "./kv-store";
import type { DynamicPricingEntry, DynamicPricingMeta } from "./types";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
export const MODELS_DEV_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 20_000;

export type SyncErrorSource = "openrouter" | "models.dev" | "d1" | "kv";

export interface SyncError {
  source: SyncErrorSource;
  message: string;
}

export interface SyncOutcome {
  ok: boolean;
  entriesWritten: number;
  meta: DynamicPricingMeta;
  warnings: string[];
  errors: SyncError[];
}

export interface SyncDeps {
  db: D1Database;
  kv: KVNamespace;
  fetchImpl?: typeof fetch;
}

interface FetchResolution {
  json: unknown | null;
  fromCache: boolean;
  error: string | null;
}

async function resolveSource(
  source: LastFetchSource,
  url: string,
  now: string,
  deps: SyncDeps
): Promise<FetchResolution> {
  const fetchFn = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    await writeLastFetch(deps.kv, source, { json, fetchedAt: now });
    return { json, fromCache: false, error: null };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const cached = await readLastFetch(deps.kv, source);
    if (cached) {
      return { json: cached.json, fromCache: true, error: message };
    }
    return { json: null, fromCache: false, error: message };
  }
}

export async function syncDynamicPricing(
  deps: SyncDeps,
  now: string
): Promise<SyncOutcome> {
  const errors: SyncError[] = [];

  const [orRes, mdRes] = await Promise.all([
    resolveSource("openrouter", OPENROUTER_URL, now, deps),
    resolveSource("models.dev", MODELS_DEV_URL, now, deps),
  ]);

  if (orRes.error) errors.push({ source: "openrouter", message: orRes.error });
  if (mdRes.error) errors.push({ source: "models.dev", message: mdRes.error });

  const orParse = parseOpenRouter(orRes.json ?? { data: [] }, now);
  const mdParse = parseModelsDev(mdRes.json ?? {}, now);

  let admin: AdminPricingRow[] = [];
  try {
    admin = await loadAdminRows(deps.db);
  } catch (err) {
    errors.push({ source: "d1", message: (err as Error).message ?? String(err) });
  }

  const merged = mergePricingSources({
    baseline: baseline as DynamicPricingEntry[],
    openRouter: orParse.entries,
    modelsDev: mdParse.entries,
    admin,
    now,
  });

  const meta: DynamicPricingMeta = {
    ...merged.meta,
    lastErrors: errors.length
      ? errors.map((e) => ({ source: e.source, at: now, message: e.message }))
      : null,
  };

  try {
    await writeDynamic(deps.kv, merged.entries);
    await writeMeta(deps.kv, meta);
  } catch (err) {
    errors.push({ source: "kv", message: (err as Error).message ?? String(err) });
  }

  return {
    ok: errors.length === 0,
    entriesWritten: merged.entries.length,
    meta,
    warnings: [...orParse.warnings, ...mdParse.warnings, ...merged.warnings],
    errors,
  };
}

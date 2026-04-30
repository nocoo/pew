/**
 * KV storage helpers for the dynamic-pricing pipeline.
 *
 * Keys live in the same `CACHE` namespace as the rest of the worker; the
 * test/prod split is by namespace ID, not key prefix. Values are JSON-encoded.
 *
 * Read operations swallow errors and return null — the cron path and the
 * `getDynamicPricing` RPC both have to fall back to bundled baseline when KV
 * is empty or malformed, so noisy throws would just become caller boilerplate.
 *
 * Write operations log on failure but do not throw — a cron run that produced
 * good entries shouldn't be considered failed because KV write was flaky.
 */

import type { KVNamespace } from "@cloudflare/workers-types";

import type { DynamicPricingEntry, DynamicPricingMeta } from "./types";

export const KEY_DYNAMIC = "pricing:dynamic";
export const KEY_DYNAMIC_META = "pricing:dynamic:meta";
export const KEY_LAST_FETCH_OPENROUTER = "pricing:last-fetch:openrouter";
export const KEY_LAST_FETCH_MODELS_DEV = "pricing:last-fetch:models-dev";

export type LastFetchSource = "openrouter" | "models.dev";

export interface CachedFetch<T = unknown> {
  json: T;
  fetchedAt: string;
}

// 24 MB — KV per-value limit is 25 MB; leave headroom for JSON overhead.
const MAX_LAST_FETCH_BYTES = 24 * 1024 * 1024;

function lastFetchKey(source: LastFetchSource): string {
  return source === "openrouter" ? KEY_LAST_FETCH_OPENROUTER : KEY_LAST_FETCH_MODELS_DEV;
}

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    const v = await kv.get(key, "json");
    if (v === null) return null;
    return v as T;
  } catch (err) {
    console.error(`dynamic pricing kv read error key=${key}:`, err);
    return null;
  }
}

async function writeJson(kv: KVNamespace, key: string, value: unknown): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value));
  } catch (err) {
    console.error(`dynamic pricing kv write error key=${key}:`, err);
  }
}

export async function readDynamic(kv: KVNamespace): Promise<DynamicPricingEntry[] | null> {
  const v = await readJson<DynamicPricingEntry[]>(kv, KEY_DYNAMIC);
  return Array.isArray(v) ? v : null;
}

export async function writeDynamic(
  kv: KVNamespace,
  entries: DynamicPricingEntry[]
): Promise<void> {
  await writeJson(kv, KEY_DYNAMIC, entries);
}

/**
 * Throwing variant of writeDynamic — orchestrator uses this so KV failures
 * surface in SyncOutcome.errors instead of being silently swallowed.
 */
export async function writeDynamicOrThrow(
  kv: KVNamespace,
  entries: DynamicPricingEntry[]
): Promise<void> {
  await kv.put(KEY_DYNAMIC, JSON.stringify(entries));
}

export async function readMeta(kv: KVNamespace): Promise<DynamicPricingMeta | null> {
  return readJson<DynamicPricingMeta>(kv, KEY_DYNAMIC_META);
}

export async function writeMeta(kv: KVNamespace, meta: DynamicPricingMeta): Promise<void> {
  await writeJson(kv, KEY_DYNAMIC_META, meta);
}

export async function writeMetaOrThrow(
  kv: KVNamespace,
  meta: DynamicPricingMeta
): Promise<void> {
  await kv.put(KEY_DYNAMIC_META, JSON.stringify(meta));
}

export async function readLastFetch(
  kv: KVNamespace,
  source: LastFetchSource
): Promise<CachedFetch | null> {
  return readJson<CachedFetch>(kv, lastFetchKey(source));
}

export async function writeLastFetch(
  kv: KVNamespace,
  source: LastFetchSource,
  payload: CachedFetch
): Promise<void> {
  const key = lastFetchKey(source);
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    console.error(`dynamic pricing last-fetch serialize error source=${source}:`, err);
    return;
  }
  if (serialized.length > MAX_LAST_FETCH_BYTES) {
    console.warn(
      `dynamic pricing last-fetch skipped source=${source} bytes=${serialized.length} (over 24 MB)`
    );
    return;
  }
  try {
    await kv.put(key, serialized);
  } catch (err) {
    console.error(`dynamic pricing kv write error key=${key}:`, err);
  }
}

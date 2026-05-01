"use client";

import { useEffect, useState } from "react";
import type {
  DynamicPricingEntryDto,
  DynamicPricingMetaDto,
} from "@/lib/rpc-types";

// ---------------------------------------------------------------------------
// Module-level singleton cache
//
// Many tooltip icons across the dashboard subscribe to the same dataset, so
// fetching from inside each component would fan out to N parallel HTTP calls.
// We keep a single in-memory promise and broadcast updates to subscribers.
// ---------------------------------------------------------------------------

interface PricingEntriesPayload {
  entries: DynamicPricingEntryDto[];
  meta: DynamicPricingMetaDto | null;
}

interface CacheState {
  data: PricingEntriesPayload | null;
  loading: boolean;
  error: string | null;
}

let cache: CacheState = { data: null, loading: false, error: null };
let inflight: Promise<PricingEntriesPayload> | null = null;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

async function loadOnce(): Promise<PricingEntriesPayload> {
  if (inflight) return inflight;
  cache = { ...cache, loading: true, error: null };
  notify();

  inflight = (async () => {
    try {
      const res = await fetch("/api/pricing/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PricingEntriesPayload;
      cache = { data: json, loading: false, error: null };
      notify();
      return json;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      cache = { ...cache, loading: false, error: message };
      notify();
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

interface UsePricingEntriesResult {
  entries: DynamicPricingEntryDto[];
  meta: DynamicPricingMetaDto | null;
  loading: boolean;
  error: string | null;
}

/**
 * Subscribe to the global dynamic-pricing entries cache. The first
 * caller triggers a single fetch from `/api/pricing/models`; later
 * callers receive the cached result without re-fetching.
 */
export function usePricingEntries(): UsePricingEntriesResult {
  const [, force] = useState(0);

  useEffect(() => {
    const sub = () => force((n) => n + 1);
    subscribers.add(sub);
    if (cache.data === null && !inflight) {
      // Fire and forget; loadOnce notifies subscribers when done.
      void loadOnce().catch(() => {
        /* error already written to cache */
      });
    }
    return () => {
      subscribers.delete(sub);
    };
  }, []);

  return {
    entries: cache.data?.entries ?? [],
    meta: cache.data?.meta ?? null,
    loading: cache.loading,
    error: cache.error,
  };
}

// ---------------------------------------------------------------------------
// Test-only reset hook (not exported in production code paths).
// ---------------------------------------------------------------------------

/** @internal Reset the module-level cache. Test use only. */
export function __resetPricingEntriesCacheForTests(): void {
  cache = { data: null, loading: false, error: null };
  inflight = null;
  subscribers.clear();
}

/** @internal Trigger a load mimicking the hook's guard. Test use only. */
export async function __triggerLoadForTests(): Promise<PricingEntriesPayload> {
  if (cache.data !== null) return cache.data;
  if (inflight) return inflight;
  return loadOnce();
}

/** @internal Read current cache state. Test use only. */
export function __getCacheForTests(): CacheState {
  return { ...cache };
}

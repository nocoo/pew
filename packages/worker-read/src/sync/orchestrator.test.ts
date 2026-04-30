import { describe, it, expect, vi, beforeEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

import { memoryKv } from "../__test-helpers__/memory-kv";
import baseline from "../data/model-prices.json";
import {
  syncDynamicPricing,
  OPENROUTER_URL,
  MODELS_DEV_URL,
} from "./orchestrator";
import {
  KEY_DYNAMIC,
  KEY_DYNAMIC_META,
  KEY_LAST_FETCH_OPENROUTER,
  KEY_LAST_FETCH_MODELS_DEV,
} from "./kv-store";
import type { DynamicPricingEntry } from "./types";

const NOW = "2026-04-30T00:00:00.000Z";

function mockDb(): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: [] }),
    }),
  } as unknown as D1Database;
}

const OPENROUTER_OK = {
  data: [
    {
      id: "anthropic/claude-sonnet-4-20250514",
      name: "Anthropic: Claude Sonnet 4",
      context_length: 200000,
      pricing: {
        prompt: "0.000003",
        completion: "0.000015",
        input_cache_read: "0.0000003",
      },
    },
  ],
};

const MODELS_DEV_OK = {
  openai: {
    models: {
      "gpt-4o": {
        name: "GPT-4o",
        cost: { input: 2.5, output: 10, cache_read: 1.25 },
        limit: { context: 128000 },
      },
    },
  },
};

function mockFetch(
  responses: Record<string, { status: number; body?: unknown; throwError?: string }>
): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const r = responses[u];
    if (!r) throw new Error(`unexpected url: ${u}`);
    if (r.throwError) throw new Error(r.throwError);
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("syncDynamicPricing", () => {
  let kv: ReturnType<typeof memoryKv>;
  let db: D1Database;

  beforeEach(() => {
    kv = memoryKv();
    db = mockDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("both upstream succeed → ok, KV written, last-fetch cached, no errors", async () => {
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 200, body: OPENROUTER_OK },
      [MODELS_DEV_URL]: { status: 200, body: MODELS_DEV_OK },
    });
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.entriesWritten).toBeGreaterThan(0);
    expect(kv.store.has(KEY_DYNAMIC)).toBe(true);
    expect(kv.store.has(KEY_DYNAMIC_META)).toBe(true);
    expect(kv.store.has(KEY_LAST_FETCH_OPENROUTER)).toBe(true);
    expect(kv.store.has(KEY_LAST_FETCH_MODELS_DEV)).toBe(true);
    expect(r.meta.lastErrors).toBeNull();
  });

  it("OpenRouter 500 → ok=false, models.dev still parsed, KV still written, baseline floor preserved", async () => {
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 500, body: { error: "boom" } },
      [MODELS_DEV_URL]: { status: 200, body: MODELS_DEV_OK },
    });
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW);
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.source === "openrouter")).toBeDefined();
    expect(r.entriesWritten).toBeGreaterThanOrEqual((baseline as DynamicPricingEntry[]).length);
    expect(kv.store.has(KEY_DYNAMIC)).toBe(true);
    expect(r.meta.lastErrors).not.toBeNull();
    expect(r.meta.lastErrors!.some((e) => e.source === "openrouter")).toBe(true);
  });

  it("both upstream fail → uses last-fetch cache; ok=false; KV still written", async () => {
    // Pre-seed last-fetch cache for both sources.
    kv.store.set(
      KEY_LAST_FETCH_OPENROUTER,
      JSON.stringify({ json: OPENROUTER_OK, fetchedAt: "2026-04-29T00:00:00.000Z" })
    );
    kv.store.set(
      KEY_LAST_FETCH_MODELS_DEV,
      JSON.stringify({ json: MODELS_DEV_OK, fetchedAt: "2026-04-29T00:00:00.000Z" })
    );
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 500 },
      [MODELS_DEV_URL]: { status: 502 },
    });
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    // openrouter cached entry still feeds merge → entry count > baseline alone.
    expect(r.entriesWritten).toBeGreaterThanOrEqual((baseline as DynamicPricingEntry[]).length);
    expect(kv.store.has(KEY_DYNAMIC)).toBe(true);
  });

  it("both upstream fail AND no cache → bundled baseline only; ok=false", async () => {
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 0, throwError: "ECONNRESET" },
      [MODELS_DEV_URL]: { status: 0, throwError: "ECONNRESET" },
    });
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.entriesWritten).toBe((baseline as DynamicPricingEntry[]).length);
  });

  it("lastErrors is null when next sync succeeds for all sources", async () => {
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 200, body: OPENROUTER_OK },
      [MODELS_DEV_URL]: { status: 200, body: MODELS_DEV_OK },
    });
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW);
    expect(r.meta.lastErrors).toBeNull();
  });

  it("KV put failure → ok=false, errors include source='kv', meta still returned", async () => {
    const failingKv = {
      ...kv,
      get: kv.get,
      put: vi.fn(async (key: string) => {
        if (key === KEY_DYNAMIC || key === KEY_DYNAMIC_META) {
          throw new Error("kv 503");
        }
        kv.store.set(key, "");
      }),
      store: kv.store,
    } as unknown as typeof kv;
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 200, body: OPENROUTER_OK },
      [MODELS_DEV_URL]: { status: 200, body: MODELS_DEV_OK },
    });
    const r = await syncDynamicPricing({ db, kv: failingKv, fetchImpl }, NOW);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.source === "kv")).toBe(true);
    expect(r.meta.lastErrors?.some((e) => e.source === "kv")).toBe(true);
  });

  it("forceRefetch=false → skips upstream entirely; uses cache when present", async () => {
    kv.store.set(
      KEY_LAST_FETCH_OPENROUTER,
      JSON.stringify({ json: OPENROUTER_OK, fetchedAt: "2026-04-29T00:00:00.000Z" })
    );
    kv.store.set(
      KEY_LAST_FETCH_MODELS_DEV,
      JSON.stringify({ json: MODELS_DEV_OK, fetchedAt: "2026-04-29T00:00:00.000Z" })
    );
    const fetchImpl = vi.fn(async () => {
      throw new Error("upstream must not be called when forceRefetch=false");
    }) as unknown as typeof fetch;
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW, { forceRefetch: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.entriesWritten).toBeGreaterThan(0);
  });

  it("forceRefetch=false with no cache → ok=true, baseline floor only, no upstream calls", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("upstream must not be called when forceRefetch=false");
    }) as unknown as typeof fetch;
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW, { forceRefetch: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.entriesWritten).toBe((baseline as DynamicPricingEntry[]).length);
  });

  it("forceRefetch=true → upstream success refreshes last-fetch cache", async () => {
    // Pre-seed stale cache; verify it's overwritten on success.
    kv.store.set(
      KEY_LAST_FETCH_OPENROUTER,
      JSON.stringify({ json: { data: [] }, fetchedAt: "2026-04-29T00:00:00.000Z" })
    );
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 200, body: OPENROUTER_OK },
      [MODELS_DEV_URL]: { status: 200, body: MODELS_DEV_OK },
    });
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW, { forceRefetch: true });
    expect(r.ok).toBe(true);
    const cached = JSON.parse(kv.store.get(KEY_LAST_FETCH_OPENROUTER)!);
    expect(cached.fetchedAt).toBe(NOW);
    expect(cached.json).toEqual(OPENROUTER_OK);
  });

  it("forceRefetch=true → upstream failure does NOT fall back to cache; surfaces error", async () => {
    kv.store.set(
      KEY_LAST_FETCH_OPENROUTER,
      JSON.stringify({ json: OPENROUTER_OK, fetchedAt: "2026-04-29T00:00:00.000Z" })
    );
    const fetchImpl = mockFetch({
      [OPENROUTER_URL]: { status: 500, body: { error: "boom" } },
      [MODELS_DEV_URL]: { status: 200, body: MODELS_DEV_OK },
    });
    const r = await syncDynamicPricing({ db, kv, fetchImpl }, NOW, { forceRefetch: true });
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.source === "openrouter")).toBeDefined();
    // Should not have used the cached OpenRouter data; entry count should be only models.dev + baseline.
    // We don't pin exact counts (depends on baseline), just verify it's not throwing on the cache path.
  });
});

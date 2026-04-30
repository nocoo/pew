import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";

import {
  readDynamic,
  writeDynamicOrThrow,
  readMeta,
  writeMeta,
  readLastFetch,
  writeLastFetch,
  KEY_DYNAMIC,
  KEY_DYNAMIC_META,
  KEY_LAST_FETCH_OPENROUTER,
  KEY_LAST_FETCH_MODELS_DEV,
} from "./kv-store";
import type { DynamicPricingEntry, DynamicPricingMeta } from "./types";

function memoryKv(): KVNamespace & {
  store: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const kv = {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === "json") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    }),
    put: vi.fn(async (key: string, value: string, _opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    }),
  } as unknown as KVNamespace & {
    store: Map<string, string>;
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
  return kv;
}

const ENTRY: DynamicPricingEntry = {
  model: "anthropic/claude-sonnet-4",
  provider: "Anthropic",
  displayName: "Claude Sonnet 4",
  inputPerMillion: 3,
  outputPerMillion: 15,
  cachedPerMillion: 0.3,
  contextWindow: 200000,
  origin: "openrouter",
  updatedAt: "2026-04-30T00:00:00.000Z",
};

const META: DynamicPricingMeta = {
  lastSyncedAt: "2026-04-30T00:00:00.000Z",
  modelCount: 1,
  baselineCount: 0,
  openRouterCount: 1,
  modelsDevCount: 0,
  adminOverrideCount: 0,
  lastErrors: null,
};

describe("kv-store", () => {
  let kv: ReturnType<typeof memoryKv>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    kv = memoryKv();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("readDynamic / writeDynamicOrThrow round-trips", async () => {
    expect(await readDynamic(kv)).toBeNull();
    await writeDynamicOrThrow(kv, [ENTRY]);
    expect(kv.store.get(KEY_DYNAMIC)).toBe(JSON.stringify([ENTRY]));
    expect(await readDynamic(kv)).toEqual([ENTRY]);
  });

  it("readMeta / writeMeta round-trips", async () => {
    expect(await readMeta(kv)).toBeNull();
    await writeMeta(kv, META);
    expect(kv.store.get(KEY_DYNAMIC_META)).toBe(JSON.stringify(META));
    expect(await readMeta(kv)).toEqual(META);
  });

  it("readDynamic returns null on malformed JSON", async () => {
    kv.store.set(KEY_DYNAMIC, "{not json");
    expect(await readDynamic(kv)).toBeNull();
  });

  it("readDynamic returns null when stored value is not an array", async () => {
    kv.store.set(KEY_DYNAMIC, JSON.stringify({ wrong: "shape" }));
    expect(await readDynamic(kv)).toBeNull();
  });

  it("readMeta returns null on malformed JSON", async () => {
    kv.store.set(KEY_DYNAMIC_META, "{not json");
    expect(await readMeta(kv)).toBeNull();
  });

  it("writeMeta swallows kv.put errors and logs", async () => {
    kv.put = vi.fn(async () => {
      throw new Error("kv 503");
    });
    await writeMeta(kv, META);
    expect(errSpy).toHaveBeenCalled();
  });

  it("readLastFetch / writeLastFetch round-trips per source", async () => {
    expect(await readLastFetch(kv, "openrouter")).toBeNull();
    expect(await readLastFetch(kv, "models.dev")).toBeNull();

    await writeLastFetch(kv, "openrouter", { json: { a: 1 }, fetchedAt: "T" });
    await writeLastFetch(kv, "models.dev", { json: { b: 2 }, fetchedAt: "U" });

    expect(kv.store.has(KEY_LAST_FETCH_OPENROUTER)).toBe(true);
    expect(kv.store.has(KEY_LAST_FETCH_MODELS_DEV)).toBe(true);
    expect(await readLastFetch(kv, "openrouter")).toEqual({
      json: { a: 1 },
      fetchedAt: "T",
    });
    expect(await readLastFetch(kv, "models.dev")).toEqual({
      json: { b: 2 },
      fetchedAt: "U",
    });
  });

  it("writeLastFetch skips payload over 24 MB and warns", async () => {
    // ~25 MB string of 'x'; cheaper than building full JSON of that size.
    const huge = "x".repeat(25 * 1024 * 1024);
    await writeLastFetch(kv, "openrouter", { json: { huge }, fetchedAt: "T" });
    expect(kv.store.has(KEY_LAST_FETCH_OPENROUTER)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("readDynamic returns null when kv.get throws and logs", async () => {
    kv.get = vi.fn(async () => {
      throw new Error("kv get 503");
    });
    expect(await readDynamic(kv)).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it("writeLastFetch returns early when payload cannot be serialized", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await writeLastFetch(kv, "openrouter", {
      json: circular,
      fetchedAt: "T",
    });
    expect(kv.store.has(KEY_LAST_FETCH_OPENROUTER)).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it("writeLastFetch passes 7-day TTL to kv.put", async () => {
    await writeLastFetch(kv, "openrouter", { json: { a: 1 }, fetchedAt: "T" });
    expect(kv.put).toHaveBeenCalledWith(
      KEY_LAST_FETCH_OPENROUTER,
      expect.any(String),
      { expirationTtl: 7 * 24 * 60 * 60 },
    );
  });

  it("writeLastFetch swallows kv.put errors and logs", async () => {
    kv.put = vi.fn(async () => {
      throw new Error("kv 503");
    });
    await writeLastFetch(kv, "models.dev", {
      json: { a: 1 },
      fetchedAt: "T",
    });
    expect(errSpy).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  __resetPricingEntriesCacheForTests,
  invalidatePricingEntries,
} from "@/hooks/use-pricing-entries";

function mockFetchSuccess() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        entries: [
          {
            model: "test-model",
            provider: "TestProvider",
            displayName: "Test",
            inputPerMillion: 3,
            outputPerMillion: 15,
            cachedPerMillion: 0.3,
            contextWindow: 200000,
            origin: "baseline" as const,
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        meta: { lastSync: "2026-05-01T00:00:00.000Z", entryCount: 1 },
      }),
  });
}

// usePricingEntries is a React hook; we can't call it outside a component.
// Instead we exercise the module-level cache via __triggerLoad (exported for
// tests) and inspect the state returned by the hook through a thin shim.
//
// The hook is simple enough that the interesting logic lives in loadOnce();
// the React wrapper just subscribes to cache state.

describe("usePricingEntries — module cache behaviour", () => {
  beforeEach(() => {
    __resetPricingEntriesCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loadOnce fetches data and caches it", async () => {
    const fetchMock = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchMock);

    // Import the trigger helper
    const { __triggerLoadForTests } = await import("@/hooks/use-pricing-entries");
    const result = await __triggerLoadForTests();

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.model).toBe("test-model");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Calling again should NOT re-fetch (cache hit)
    const result2 = await __triggerLoadForTests();
    expect(result2.entries).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a transient error", async () => {
    const failingFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", failingFetch);

    const { __triggerLoadForTests, __getCacheForTests } = await import(
      "@/hooks/use-pricing-entries"
    );

    // First call fails
    await expect(__triggerLoadForTests()).rejects.toThrow("HTTP 503");
    const cacheAfterFail = __getCacheForTests();
    expect(cacheAfterFail.error).toBe("HTTP 503");
    expect(cacheAfterFail.data).toBeNull();

    // Replace with success
    const successFetch = mockFetchSuccess();
    vi.stubGlobal("fetch", successFetch);

    // Second call should retry (error was cleared)
    const result = await __triggerLoadForTests();
    expect(result.entries).toHaveLength(1);
    const cacheAfterRetry = __getCacheForTests();
    expect(cacheAfterRetry.error).toBeNull();
    expect(cacheAfterRetry.data).not.toBeNull();
  });

  it("deduplicates parallel calls via inflight promise", async () => {
    const fetchMock = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchMock);

    const { __triggerLoadForTests } = await import("@/hooks/use-pricing-entries");
    const [r1, r2] = await Promise.all([
      __triggerLoadForTests(),
      __triggerLoadForTests(),
    ]);

    expect(r1).toBe(r2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires (stale-while-revalidate)", async () => {
    const fetchMock = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchMock);

    const { __triggerLoadForTests } = await import("@/hooks/use-pricing-entries");

    // Initial fetch
    await __triggerLoadForTests();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance time past the 5-minute TTL
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    // Next call should trigger a refetch
    const updatedFetch = mockFetchSuccess();
    vi.stubGlobal("fetch", updatedFetch);
    await __triggerLoadForTests();
    expect(updatedFetch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("invalidatePricingEntries triggers immediate refetch and notifies subscribers", async () => {
    const fetchMock = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchMock);

    const { __triggerLoadForTests, __getCacheForTests } = await import(
      "@/hooks/use-pricing-entries"
    );

    // Initial fetch
    await __triggerLoadForTests();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__getCacheForTests().data).not.toBeNull();

    // Replace with updated pricing
    const updatedFetch = mockFetchSuccess();
    vi.stubGlobal("fetch", updatedFetch);

    // Invalidate — should trigger a background refetch
    invalidatePricingEntries();

    // Wait for the background fetch to complete and update cache
    await vi.waitFor(() => {
      expect(__getCacheForTests().cachedAt).toBeGreaterThan(0);
    });
    expect(updatedFetch).toHaveBeenCalledTimes(1);
  });
});

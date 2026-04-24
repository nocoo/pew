"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { throwApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseFetchDataOptions {
  /** When false, skip fetching entirely. Defaults to true. */
  enabled?: boolean;
  /** Initial value for `loading` state. Defaults to true. */
  initialLoading?: boolean;
}

interface UseFetchDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Shared data-fetching hook that encapsulates the
 * `useState / useEffect / fetch / AbortController` boilerplate.
 *
 * @param url - The URL to fetch. Pass `null` to skip fetching (conditional hooks).
 * @param options - Optional configuration.
 */
export function useFetchData<T>(
  url: string | null,
  options?: UseFetchDataOptions,
): UseFetchDataResult<T> {
  const { enabled = true, initialLoading = true } = options ?? {};

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);

  // Stable ref so `refetch` never causes extra renders / effect re-runs
  const urlRef = useRef(url);
  // eslint-disable-next-line react-hooks/refs -- ref kept in sync with prop to avoid effect re-runs
  urlRef.current = url;

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      const target = urlRef.current;
      if (!target || !enabled) return;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(target, signal ? { signal } : undefined);

        if (signal?.aborted) return;

        if (!res.ok) {
          await throwApiError(res);
        }

        const json = (await res.json()) as T;

        if (signal?.aborted) return;

        setData(json);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setData(null);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    // `url` is intentionally included so the effect re-runs when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, enabled],
  );

  useEffect(() => {
    if (!url || !enabled) {
      // Reset state when disabled / no URL
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();

    fetchData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchData, url, enabled]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch };
}

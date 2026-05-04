"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

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

/**
 * Shared data-fetching hook backed by SWR. Kept for backward compatibility
 * with consumers that expect `{ data, loading, error, refetch }`.
 *
 * @param url - The URL to fetch. Pass `null` to skip fetching.
 * @param options - Optional configuration.
 */
export function useFetchData<T>(
  url: string | null,
  options?: UseFetchDataOptions,
): UseFetchDataResult<T> {
  const { enabled = true } = options ?? {};

  const key = enabled && url ? url : null;
  const { data, error, isLoading, mutate } = useSWR<T>(key, fetcher);

  return {
    data: data ?? null,
    loading: key ? isLoading : false,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch: () => {
      void mutate();
    },
  };
}

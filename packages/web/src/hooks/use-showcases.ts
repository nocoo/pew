/**
 * Hook for fetching showcases list.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { throwApiError } from "@/lib/api-error";
import { toErrorMessage } from "@/lib/error-message";
import { fetcher } from "@/lib/fetcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShowcaseUser {
  id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  slug: string | null;
}

export interface Showcase {
  id: string;
  repo_key: string;
  github_url: string;
  title: string;
  description: string | null;
  tagline: string | null;
  og_image_url: string | null;
  upvote_count: number;
  is_public: boolean;
  created_at: string;
  refreshed_at?: string;
  // GitHub stats
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
  // User info
  user: ShowcaseUser;
  has_upvoted: boolean | null;
}

export interface ShowcasesResponse {
  showcases: Showcase[];
  total: number;
  limit: number;
  offset: number;
}

export interface UseShowcasesOptions {
  mine?: boolean;
  limit?: number;
  offset?: number;
}

export interface UseShowcasesResult {
  data: ShowcasesResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShowcases(options: UseShowcasesOptions = {}): UseShowcasesResult {
  const { mine = false, limit = 20, offset = 0 } = options;

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (mine) params.set("mine", "1");
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    return `/api/showcases?${params.toString()}`;
  }, [mine, limit, offset]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<ShowcasesResponse>(
    url,
    fetcher,
  );

  return {
    data: data ?? null,
    loading: isLoading,
    refreshing: isValidating && !isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch: () => {
      void mutate();
    },
  };
}

// ---------------------------------------------------------------------------
// Preview Hook
// ---------------------------------------------------------------------------

export interface ShowcasePreview {
  repo_key: string;
  github_url: string;
  title: string;
  description: string | null;
  og_image_url: string;
  already_exists: boolean;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
}

export interface UseShowcasePreviewResult {
  preview: ShowcasePreview | null;
  loading: boolean;
  error: string | null;
  fetchPreview: (url: string) => Promise<ShowcasePreview | null>;
  reset: () => void;
}

export function useShowcasePreview(): UseShowcasePreviewResult {
  const [preview, setPreview] = useState<ShowcasePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async (url: string): Promise<ShowcasePreview | null> => {
    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const res = await fetch("/api/showcases/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_url: url }),
      });

      if (!res.ok) {
        await throwApiError(res);
      }

      const json = (await res.json()) as ShowcasePreview;
      setPreview(json);
      return json;
    } catch (err) {
      const message = toErrorMessage(err);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return { preview, loading, error, fetchPreview, reset };
}

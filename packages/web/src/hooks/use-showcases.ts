/**
 * Hook for fetching showcases list.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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

  const [data, setData] = useState<ShowcasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether we have data to determine loading vs refreshing
  const hasDataRef = useRef(false);

  const fetchData = useCallback(async () => {
    // Use ref to check if we have data (avoids data in deps)
    if (!hasDataRef.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      if (mine) params.set("mine", "1");
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const res = await fetch(`/api/showcases?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as ShowcasesResponse;
      setData(json);
      hasDataRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mine, limit, offset]);

  useEffect(() => {
    // Reset hasDataRef when params change to show loading state
    hasDataRef.current = false;
    fetchData();
  }, [fetchData]);

  return { data, loading, refreshing, error, refetch: fetchData };
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
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as ShowcasePreview;
      setPreview(json);
      return json;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
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

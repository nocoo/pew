"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BadgeIconType } from "@pew/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderboardPeriod = "week" | "month" | "all";
export type LeaderboardScope = "global" | "org" | "team";

export interface LeaderboardBadge {
  text: string;
  icon: BadgeIconType;
  colorBg: string;
  colorText: string;
}

export interface LeaderboardEntry {
  rank: number;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    slug: string | null;
  };
  teams: { id: string; name: string; logo_url: string | null }[];
  badges: LeaderboardBadge[];
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  session_count: number | null;
  total_duration_seconds: number | null;
}

export interface LeaderboardData {
  period: string;
  scope: LeaderboardScope;
  scopeId?: string;
  entries: LeaderboardEntry[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseLeaderboardOptions {
  period?: LeaderboardPeriod;
  limit?: number;
  teamId?: string | null;
  orgId?: string | null;
  source?: string | null;
  model?: string | null;
  /** Delay initial fetch until true (for scope initialization) */
  enabled?: boolean;
}

interface UseLeaderboardResult {
  /** All accumulated entries across pages */
  entries: LeaderboardEntry[];
  /** True during initial load (no entries yet) */
  loading: boolean;
  /** True when loading more pages (entries already visible) */
  loadingMore: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Whether more pages are available */
  hasMore: boolean;
  /** Load the next page */
  loadMore: () => void;
  /** Re-fetch from the beginning */
  refetch: () => void;
  /** Index where new entries start (for animation) */
  animationStartIndex: number;
}

/** Generate a stable key for filter params */
function makeFilterKey(
  period: string,
  teamId: string | null | undefined,
  orgId: string | null | undefined,
  source: string | null | undefined,
  model: string | null | undefined,
): string {
  return `${period}|${teamId ?? ""}|${orgId ?? ""}|${source ?? ""}|${model ?? ""}`;
}

export function useLeaderboard(
  options: UseLeaderboardOptions = {},
): UseLeaderboardResult {
  const { period = "week", limit = 20, teamId, orgId, source, model, enabled = true } = options;

  // All accumulated entries
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  // Current offset for pagination
  const [offset, setOffset] = useState(0);
  // Loading states
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Error and pagination info
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // Animation tracking
  const [animationStartIndex, setAnimationStartIndex] = useState(0);

  // Request counter for stale response detection
  // Each new request increments this; responses check if their ID matches current
  const requestIdRef = useRef(0);

  // Track last fetched filter key to detect changes
  const lastFilterKeyRef = useRef<string | null>(null);

  // Current filter key
  const filterKey = makeFilterKey(period, teamId, orgId, source, model);

  // Fetch a single page
  const fetchPage = useCallback(
    async (pageOffset: number, isLoadMore: boolean, requestId: number) => {
      // Set appropriate loading state
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        // Clear entries immediately on filter change
        setEntries([]);
        setAnimationStartIndex(0);
      }
      setError(null);

      try {
        const params = new URLSearchParams({ period });
        params.set("limit", String(limit));
        if (pageOffset > 0) {
          params.set("offset", String(pageOffset));
        }
        if (teamId) {
          params.set("team", teamId);
        }
        if (orgId) {
          params.set("org", orgId);
        }
        if (source) {
          params.set("source", source);
        }
        if (model) {
          params.set("model", model);
        }

        const res = await fetch(`/api/leaderboard?${params.toString()}`);

        // Check if this request is stale (a newer request has been issued)
        if (requestId !== requestIdRef.current) {
          return; // Stale response, discard
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        const json = (await res.json()) as LeaderboardData;

        // Double-check staleness after JSON parse (in case another request started)
        if (requestId !== requestIdRef.current) {
          return; // Stale response, discard
        }

        if (isLoadMore) {
          // Append to existing entries
          setEntries((prev) => {
            setAnimationStartIndex(prev.length);
            return [...prev, ...json.entries];
          });
        } else {
          // Replace entries
          setAnimationStartIndex(0);
          setEntries(json.entries);
        }
        setHasMore(json.hasMore);
      } catch (err) {
        // Only set error if this request is still current
        if (requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        // Only clear loading state if this request is still current
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [period, limit, teamId, orgId, source, model],
  );

  // Fetch when filters change or on initial mount (when enabled)
  useEffect(() => {
    if (!enabled) {
      // Reset so re-enabling with the same filter key will refetch
      lastFilterKeyRef.current = null;
      return;
    }

    const shouldFetch = lastFilterKeyRef.current !== filterKey;
    if (shouldFetch) {
      lastFilterKeyRef.current = filterKey;
      setOffset(0);
      // Increment request ID to invalidate any in-flight requests
      const requestId = ++requestIdRef.current;
      fetchPage(0, false, requestId);
    }
  }, [enabled, filterKey, fetchPage]);

  // Load more handler
  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    const newOffset = offset + limit;
    setOffset(newOffset);
    // Increment request ID for this pagination request
    const requestId = ++requestIdRef.current;
    fetchPage(newOffset, true, requestId);
  }, [loadingMore, loading, hasMore, offset, limit, fetchPage]);

  // Refetch from beginning
  const refetch = useCallback(() => {
    setOffset(0);
    const requestId = ++requestIdRef.current;
    fetchPage(0, false, requestId);
  }, [fetchPage]);

  return {
    entries,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refetch,
    animationStartIndex,
  };
}

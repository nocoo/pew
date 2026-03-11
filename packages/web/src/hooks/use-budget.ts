"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Budget {
  budget_usd: number | null;
  budget_tokens: number | null;
  month: string;
}

interface UseBudgetResult {
  /** Current budget for the month, or null if none set / still loading. */
  budget: Budget | null;
  loading: boolean;
  error: string | null;
  /** Save (create or update) budget for the month. */
  saveBudget: (input: Partial<Budget>) => Promise<void>;
  /** Delete (clear) budget for the month. */
  deleteBudget: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch and update budget for a given month via /api/budgets.
 *
 * @param month YYYY-MM format
 */
export function useBudget(month: string): UseBudgetResult {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Fetch ---------------------------------------------------------------

  const fetchBudget = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/budgets?month=${month}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      const json = (await res.json()) as Budget | null;
      setBudget(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchBudget();
  }, [fetchBudget]);

  // ---- Save ----------------------------------------------------------------

  const saveBudget = useCallback(
    async (input: Partial<Budget>) => {
      setError(null);

      try {
        const res = await fetch("/api/budgets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, month }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        // Re-fetch to get the canonical state
        await fetchBudget();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        throw err; // Allow callers (dialog) to handle
      }
    },
    [month, fetchBudget],
  );

  // ---- Delete --------------------------------------------------------------

  const deleteBudget = useCallback(async () => {
    setError(null);

    try {
      const res = await fetch(`/api/budgets?month=${month}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      // Clear local state — no budget anymore
      setBudget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      throw err;
    }
  }, [month]);

  return { budget, loading, error, saveBudget, deleteBudget };
}

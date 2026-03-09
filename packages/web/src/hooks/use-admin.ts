"use client";

import { useState, useEffect } from "react";

interface UseAdminResult {
  isAdmin: boolean;
  loading: boolean;
}

/**
 * Check if the current user is an admin.
 * Calls GET /api/admin/check once on mount.
 */
export function useAdmin(): UseAdminResult {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/admin/check");
        if (!res.ok) {
          setIsAdmin(false);
          return;
        }
        const json = (await res.json()) as { isAdmin: boolean };
        if (!cancelled) setIsAdmin(json.isAdmin);
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  return { isAdmin, loading };
}

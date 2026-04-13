"use client";

import { useState, useEffect, useCallback } from "react";
import type { DevicesResponse } from "@pew/core";
import { throwApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDevicesResult {
  data: DevicesResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  updateAlias: (
    deviceId: string,
    alias: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteDevice: (
    deviceId: string
  ) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Fetch device list from GET /api/devices and expose alias mutation.
 * Refetches full list after every successful mutation.
 */
export function useDevices(): UseDevicesResult {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/devices");

      if (!res.ok) {
        await throwApiError(res);
      }

      const json = (await res.json()) as DevicesResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateAlias = useCallback(
    async (
      deviceId: string,
      alias: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/devices", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId, alias }),
        });

        if (!res.ok) {
          await throwApiError(res);
        }

        // Refetch full list after mutation
        await fetchData();
        return { success: true };
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        return { success: false, error: errorMsg };
      }
    },
    [fetchData]
  );

  const deleteDevice = useCallback(
    async (
      deviceId: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/devices", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: deviceId }),
        });

        if (!res.ok) {
          await throwApiError(res);
        }

        // Refetch full list after deletion
        await fetchData();
        return { success: true };
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        return { success: false, error: errorMsg };
      }
    },
    [fetchData]
  );

  return { data, loading, error, refetch: fetchData, updateAlias, deleteDevice };
}

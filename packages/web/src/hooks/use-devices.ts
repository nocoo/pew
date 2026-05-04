"use client";

import { useCallback } from "react";
import useSWR from "swr";
import type { DevicesResponse } from "@pew/core";
import { throwApiError } from "@/lib/api-error";
import { fetcher } from "@/lib/fetcher";

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

export function useDevices(): UseDevicesResult {
  const { data, error, isLoading, mutate } = useSWR<DevicesResponse>(
    "/api/devices",
    fetcher,
  );

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

        await mutate();
        return { success: true };
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        return { success: false, error: errorMsg };
      }
    },
    [mutate]
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

        await mutate();
        return { success: true };
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        return { success: false, error: errorMsg };
      }
    },
    [mutate]
  );

  return {
    data: data ?? null,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch: () => {
      void mutate();
    },
    updateAlias,
    deleteDevice,
  };
}

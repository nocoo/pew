import { useMemo } from "react";

/**
 * Returns the browser's current timezone offset in minutes.
 *
 * Frozen per mount — acceptable; page refresh handles DST changes.
 *
 * Use only inside `"use client"` components or other client-side hooks.
 * In SSR contexts `new Date().getTimezoneOffset()` resolves to the
 * server's timezone, which is not what dashboard pages want.
 */
export function useTzOffset(): number {
  return useMemo(() => new Date().getTimezoneOffset(), []);
}

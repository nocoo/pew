import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format large token counts to human-readable string (e.g. 1.2M, 45.3K) */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${(count / 1_000_000_000).toFixed(1)}B`;
}

/** Format token count with full digits and comma separators (e.g. 11,832,456,789) */
export function formatTokensFull(count: number): string {
  return count.toLocaleString("en-US");
}

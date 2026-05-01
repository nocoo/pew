import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Re-exported from `lib/format` so existing call sites keep working.
// New code should prefer importing directly from `@/lib/format`.
export { formatTokens, formatTokensFull } from "./format";

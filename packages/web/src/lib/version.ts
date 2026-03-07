/**
 * Centralized app version constant.
 *
 * The version is injected at build time by next.config.ts from the
 * monorepo root package.json (single source of truth).
 *
 * Works in both server and client components.
 */
export const APP_VERSION: string =
  process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.1";

/**
 * Shared test utilities for @pew/web unit tests.
 *
 * Provides mock factories for the DB abstraction layer and common request
 * builders so individual test files don't need to duplicate boilerplate.
 *
 * NOTE: `vi.mock(...)` calls CANNOT be extracted here — vitest hoists them
 * to the top of each test file at compile time. Each test file must still
 * declare its own `vi.mock("@/lib/db", ...)` etc.
 */

import { vi } from "vitest";
import type { DbRead, DbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// Mock DB factories
// ---------------------------------------------------------------------------

/** Mock DbRead with all methods (legacy SQL proxy + users RPC). */
export function createMockDbRead() {
  return {
    // Legacy SQL proxy
    query: vi.fn(),
    firstOrNull: vi.fn(),
    // Users RPC methods
    getUserById: vi.fn(),
    getUserBySlug: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByApiKey: vi.fn(),
    getUserByOAuthAccount: vi.fn(),
    checkSlugExists: vi.fn(),
    getUserSettings: vi.fn(),
    getUserApiKey: vi.fn(),
    getUserEmail: vi.fn(),
    searchUsers: vi.fn(),
  } as unknown as DbRead & {
    query: ReturnType<typeof vi.fn>;
    firstOrNull: ReturnType<typeof vi.fn>;
    getUserById: ReturnType<typeof vi.fn>;
    getUserBySlug: ReturnType<typeof vi.fn>;
    getUserByEmail: ReturnType<typeof vi.fn>;
    getUserByApiKey: ReturnType<typeof vi.fn>;
    getUserByOAuthAccount: ReturnType<typeof vi.fn>;
    checkSlugExists: ReturnType<typeof vi.fn>;
    getUserSettings: ReturnType<typeof vi.fn>;
    getUserApiKey: ReturnType<typeof vi.fn>;
    getUserEmail: ReturnType<typeof vi.fn>;
    searchUsers: ReturnType<typeof vi.fn>;
  };
}

/** Mock DbWrite with `execute` + `batch`. */
export function createMockDbWrite() {
  return {
    execute: vi.fn(),
    batch: vi.fn(),
  } as unknown as DbWrite & {
    execute: ReturnType<typeof vi.fn>;
    batch: ReturnType<typeof vi.fn>;
  };
}

/**
 * Legacy "god mock" that combines read + write methods.
 * Prefer `createMockDbRead()` + `createMockDbWrite()` for new tests.
 */
export function createMockClient() {
  return {
    // Legacy SQL proxy
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
    // Users RPC methods
    getUserById: vi.fn(),
    getUserBySlug: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByApiKey: vi.fn(),
    getUserByOAuthAccount: vi.fn(),
    checkSlugExists: vi.fn(),
    getUserSettings: vi.fn(),
    getUserApiKey: vi.fn(),
    getUserEmail: vi.fn(),
    searchUsers: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

const BASE = "http://localhost:7020";

/** Build a GET request with optional query params. */
export function makeGetRequest(
  path: string,
  params: Record<string, string> = {},
): Request {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

/** Build a JSON request with method + optional body. */
export function makeJsonRequest(
  method: string,
  path: string,
  body?: unknown,
): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, init);
}

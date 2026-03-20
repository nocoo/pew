import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Session } from "next-auth";

// Mock @/auth — must be before importing auth-helpers
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Mock @/lib/db — must be before importing auth-helpers
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

const { auth } = await import("@/auth") as unknown as {
  auth: ReturnType<typeof vi.fn>;
};
const { getDbRead } = await import("@/lib/db") as unknown as {
  getDbRead: ReturnType<typeof vi.fn>;
};
const {
  resolveUser,
  E2E_TEST_USER_ID,
  E2E_TEST_USER_EMAIL,
} = await import("@/lib/auth-helpers");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request("http://localhost:7030/api/ingest", {
    method: "POST",
    headers,
  });
}

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Default: not in E2E mode
    delete process.env.E2E_SKIP_AUTH;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ---------- E2E bypass ----------

  describe("E2E bypass mode", () => {
    it("should return deterministic test user when E2E_SKIP_AUTH=true and NODE_ENV=development", async () => {
      process.env.E2E_SKIP_AUTH = "true";
      vi.stubEnv("NODE_ENV", "development");

      const result = await resolveUser(makeRequest());

      expect(result).toEqual({
        userId: E2E_TEST_USER_ID,
        email: E2E_TEST_USER_EMAIL,
      });
      // Should NOT call auth() or D1
      expect(auth).not.toHaveBeenCalled();
      expect(getDbRead).not.toHaveBeenCalled();
    });

    it("should NOT bypass when E2E_SKIP_AUTH is false", async () => {
      process.env.E2E_SKIP_AUTH = "false";
      vi.stubEnv("NODE_ENV", "development");
      auth.mockResolvedValueOnce(null);

      const result = await resolveUser(makeRequest());

      expect(result).toBeNull();
      expect(auth).toHaveBeenCalled();
    });

    it("should NOT bypass when NODE_ENV is production", async () => {
      process.env.E2E_SKIP_AUTH = "true";
      vi.stubEnv("NODE_ENV", "production");
      auth.mockResolvedValueOnce(null);

      const result = await resolveUser(makeRequest());

      expect(result).toBeNull();
      expect(auth).toHaveBeenCalled();
    });
  });

  // ---------- Session auth ----------

  describe("session auth", () => {
    it("should return user from Auth.js session", async () => {
      auth.mockResolvedValueOnce({
        user: { id: "u-session-1", email: "user@example.com" },
      } as Session);

      const result = await resolveUser(makeRequest());

      expect(result).toEqual({
        userId: "u-session-1",
        email: "user@example.com",
      });
      expect(getDbRead).not.toHaveBeenCalled();
    });

    it("should handle session user with no email", async () => {
      auth.mockResolvedValueOnce({
        user: { id: "u-no-email" },
      } as Session);

      const result = await resolveUser(makeRequest());

      expect(result).toEqual({
        userId: "u-no-email",
        email: undefined,
      });
    });

    it("should fall through to Bearer auth when session has no user id", async () => {
      auth.mockResolvedValueOnce({
        user: { email: "no-id@example.com" },
      } as Session);

      const result = await resolveUser(makeRequest());

      // No Bearer token either → null
      expect(result).toBeNull();
    });

    it("should fall through to Bearer auth when session is null", async () => {
      auth.mockResolvedValueOnce(null);

      const mockClient = createMockClient();
      mockClient.firstOrNull.mockResolvedValueOnce({
        id: "u-api-key-1",
        email: "api@example.com",
      });
      getDbRead.mockResolvedValueOnce(mockClient);

      const result = await resolveUser(makeRequest("pk_valid_key"));

      expect(result).toEqual({
        userId: "u-api-key-1",
        email: "api@example.com",
      });
    });
  });

  // ---------- Bearer API key auth ----------

  describe("Bearer API key auth", () => {
    beforeEach(() => {
      auth.mockResolvedValue(null); // No session
    });

    it("should resolve user from valid API key", async () => {
      const mockClient = createMockClient();
      mockClient.firstOrNull.mockResolvedValueOnce({
        id: "u-api-1",
        email: "apiuser@example.com",
      });
      getDbRead.mockResolvedValueOnce(mockClient);

      const result = await resolveUser(makeRequest("pk_test_key_123"));

      expect(result).toEqual({
        userId: "u-api-1",
        email: "apiuser@example.com",
      });
      expect(mockClient.firstOrNull).toHaveBeenCalledWith(
        "SELECT id, email FROM users WHERE api_key = ?",
        ["pk_test_key_123"],
      );
    });

    it("should return null for invalid API key (no DB match)", async () => {
      const mockClient = createMockClient();
      mockClient.firstOrNull.mockResolvedValueOnce(null);
      getDbRead.mockResolvedValueOnce(mockClient);

      const result = await resolveUser(makeRequest("pk_bad_key"));

      expect(result).toBeNull();
    });

    it("should return null when no Authorization header", async () => {
      const result = await resolveUser(makeRequest());

      expect(result).toBeNull();
      expect(getDbRead).not.toHaveBeenCalled();
    });

    it("should return null when Authorization header is not Bearer", async () => {
      const req = new Request("http://localhost:7030/api/test", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });

      const result = await resolveUser(req);

      expect(result).toBeNull();
      expect(getDbRead).not.toHaveBeenCalled();
    });
  });

  // ---------- Priority order ----------

  describe("auth priority", () => {
    it("should prefer session over Bearer token when both exist", async () => {
      auth.mockResolvedValueOnce({
        user: { id: "u-session", email: "session@example.com" },
      } as Session);

      const result = await resolveUser(makeRequest("pk_ignored_key"));

      expect(result).toEqual({
        userId: "u-session",
        email: "session@example.com",
      });
      // Should NOT even check D1 for the API key
      expect(getDbRead).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleUsersRpc,
  type GetUserByIdRequest,
  type GetUserBySlugRequest,
  type GetUserByEmailRequest,
  type GetUserByApiKeyRequest,
  type GetUserByOAuthAccountRequest,
  type CheckSlugExistsRequest,
  type GetUserSettingsRequest,
  type GetUserApiKeyRequest,
  type GetUserEmailRequest,
  type SearchUsersRequest,
} from "./users";

// ---------------------------------------------------------------------------
// Mock D1Database
// ---------------------------------------------------------------------------

function createMockDB() {
  const first = vi.fn();
  const all = vi.fn();
  const bind = vi.fn().mockReturnValue({ first, all });
  const prepare = vi.fn().mockReturnValue({ bind, first, all });
  return { prepare, bind, first, all } as unknown as D1Database & {
    bind: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Users RPC handlers", () => {
  let db: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDB();
  });

  // -------------------------------------------------------------------------
  // users.getById
  // -------------------------------------------------------------------------

  describe("users.getById", () => {
    it("should return user when found", async () => {
      const mockUser = {
        id: "usr_123",
        email: "test@example.com",
        name: "Test User",
        image: "https://example.com/avatar.jpg",
        email_verified: "2026-01-01T00:00:00Z",
      };
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(mockUser) });

      const request: GetUserByIdRequest = { method: "users.getById", id: "usr_123" };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: mockUser });
      expect(db.prepare).toHaveBeenCalledWith(
        "SELECT id, email, name, image, email_verified FROM users WHERE id = ?",
      );
    });

    it("should return null when user not found", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: GetUserByIdRequest = { method: "users.getById", id: "nonexistent" };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when id is missing", async () => {
      const request = { method: "users.getById", id: "" } as GetUserByIdRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("id");
    });
  });

  // -------------------------------------------------------------------------
  // users.getBySlug
  // -------------------------------------------------------------------------

  describe("users.getBySlug", () => {
    it("should return user profile when found", async () => {
      const mockProfile = {
        id: "usr_123",
        name: "Test User",
        nickname: "tester",
        image: "https://example.com/avatar.jpg",
        slug: "testuser",
        created_at: "2026-01-01T00:00:00Z",
        is_public: 1,
      };
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(mockProfile) });

      const request: GetUserBySlugRequest = { method: "users.getBySlug", slug: "testuser" };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: mockProfile });
      expect(db.prepare).toHaveBeenCalledWith(
        "SELECT id, name, nickname, image, slug, created_at, is_public FROM users WHERE slug = ?",
      );
    });

    it("should return null when slug not found", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: GetUserBySlugRequest = { method: "users.getBySlug", slug: "nonexistent" };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when slug is missing", async () => {
      const request = { method: "users.getBySlug", slug: "" } as GetUserBySlugRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.getByEmail
  // -------------------------------------------------------------------------

  describe("users.getByEmail", () => {
    it("should return user when found by email", async () => {
      const mockUser = {
        id: "usr_123",
        email: "test@example.com",
        name: "Test User",
        image: null,
        email_verified: null,
      };
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(mockUser) });

      const request: GetUserByEmailRequest = {
        method: "users.getByEmail",
        email: "test@example.com",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: mockUser });
    });

    it("should return 400 when email is missing", async () => {
      const request = { method: "users.getByEmail", email: "" } as GetUserByEmailRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.getByApiKey
  // -------------------------------------------------------------------------

  describe("users.getByApiKey", () => {
    it("should return user id and email when found by API key", async () => {
      const mockUser = { id: "usr_123", email: "test@example.com" };
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(mockUser) });

      const request: GetUserByApiKeyRequest = {
        method: "users.getByApiKey",
        apiKey: "pk_test_123",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: mockUser });
      expect(db.prepare).toHaveBeenCalledWith(
        "SELECT id, email FROM users WHERE api_key = ?",
      );
    });

    it("should return null when API key not found", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: GetUserByApiKeyRequest = {
        method: "users.getByApiKey",
        apiKey: "invalid_key",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when apiKey is missing", async () => {
      const request = { method: "users.getByApiKey", apiKey: "" } as GetUserByApiKeyRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.getByOAuthAccount
  // -------------------------------------------------------------------------

  describe("users.getByOAuthAccount", () => {
    it("should return user when found by OAuth account", async () => {
      const mockUser = {
        id: "usr_123",
        email: "test@example.com",
        name: "Test User",
        image: "https://example.com/avatar.jpg",
        email_verified: "2026-01-01T00:00:00Z",
      };
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(mockUser) });

      const request: GetUserByOAuthAccountRequest = {
        method: "users.getByOAuthAccount",
        provider: "github",
        providerAccountId: "12345",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: mockUser });
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("JOIN accounts"));
    });

    it("should return null when OAuth account not found", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: GetUserByOAuthAccountRequest = {
        method: "users.getByOAuthAccount",
        provider: "github",
        providerAccountId: "nonexistent",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when provider is missing", async () => {
      const request = {
        method: "users.getByOAuthAccount",
        provider: "",
        providerAccountId: "12345",
      } as GetUserByOAuthAccountRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });

    it("should return 400 when providerAccountId is missing", async () => {
      const request = {
        method: "users.getByOAuthAccount",
        provider: "github",
        providerAccountId: "",
      } as GetUserByOAuthAccountRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.checkSlugExists
  // -------------------------------------------------------------------------

  describe("users.checkSlugExists", () => {
    it("should return exists: true when slug is taken", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue({ id: "usr_other" }) });

      const request: CheckSlugExistsRequest = {
        method: "users.checkSlugExists",
        slug: "taken-slug",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: { exists: true } });
    });

    it("should return exists: false when slug is available", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: CheckSlugExistsRequest = {
        method: "users.checkSlugExists",
        slug: "available-slug",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: { exists: false } });
    });

    it("should exclude current user when excludeUserId is provided", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: CheckSlugExistsRequest = {
        method: "users.checkSlugExists",
        slug: "my-slug",
        excludeUserId: "usr_123",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      expect(db.prepare).toHaveBeenCalledWith(
        "SELECT id FROM users WHERE slug = ? AND id != ?",
      );
    });

    it("should return 400 when slug is missing", async () => {
      const request = { method: "users.checkSlugExists", slug: "" } as CheckSlugExistsRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.getSettings
  // -------------------------------------------------------------------------

  describe("users.getSettings", () => {
    it("should return user settings", async () => {
      const mockSettings = { nickname: "tester", slug: "testuser", is_public: 1 };
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(mockSettings) });

      const request: GetUserSettingsRequest = {
        method: "users.getSettings",
        userId: "usr_123",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: mockSettings });
    });

    it("should return null when user not found", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: GetUserSettingsRequest = {
        method: "users.getSettings",
        userId: "nonexistent",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when userId is missing", async () => {
      const request = { method: "users.getSettings", userId: "" } as GetUserSettingsRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.getApiKey
  // -------------------------------------------------------------------------

  describe("users.getApiKey", () => {
    it("should return api_key when exists", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue({ api_key: "pk_test_123" }) });

      const request: GetUserApiKeyRequest = {
        method: "users.getApiKey",
        userId: "usr_123",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: { api_key: "pk_test_123" } });
    });

    it("should return api_key: null when user has no key", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue({ api_key: null }) });

      const request: GetUserApiKeyRequest = {
        method: "users.getApiKey",
        userId: "usr_123",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: { api_key: null } });
    });

    it("should return 400 when userId is missing", async () => {
      const request = { method: "users.getApiKey", userId: "" } as GetUserApiKeyRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.getEmail
  // -------------------------------------------------------------------------

  describe("users.getEmail", () => {
    it("should return email", async () => {
      db.bind.mockReturnValue({
        first: vi.fn().mockResolvedValue({ email: "test@example.com" }),
      });

      const request: GetUserEmailRequest = {
        method: "users.getEmail",
        userId: "usr_123",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: { email: "test@example.com" } });
    });

    it("should return null when user not found", async () => {
      db.bind.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });

      const request: GetUserEmailRequest = {
        method: "users.getEmail",
        userId: "nonexistent",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: null });
    });

    it("should return 400 when userId is missing", async () => {
      const request = { method: "users.getEmail", userId: "" } as GetUserEmailRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // users.search
  // -------------------------------------------------------------------------

  describe("users.search", () => {
    it("should return matching users", async () => {
      const mockUsers = [
        { id: "usr_1", name: "John Doe", email: "john@example.com", image: null },
        { id: "usr_2", name: "Jane Doe", email: "jane@example.com", image: null },
      ];
      db.bind.mockReturnValue({ all: vi.fn().mockResolvedValue({ results: mockUsers }) });

      const request: SearchUsersRequest = {
        method: "users.search",
        query: "doe",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: mockUsers });
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("LIKE"));
    });

    it("should return empty array when no matches", async () => {
      db.bind.mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) });

      const request: SearchUsersRequest = {
        method: "users.search",
        query: "nonexistent",
      };
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ result: [] });
    });

    it("should respect custom limit", async () => {
      db.bind.mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) });

      const request: SearchUsersRequest = {
        method: "users.search",
        query: "test",
        limit: 5,
      };
      await handleUsersRpc(request, db);

      // Verify bind was called with limit=5
      expect(db.bind).toHaveBeenCalledWith("%test%", "%test%", 5);
    });

    it("should cap limit at 100", async () => {
      db.bind.mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) });

      const request: SearchUsersRequest = {
        method: "users.search",
        query: "test",
        limit: 500,
      };
      await handleUsersRpc(request, db);

      // Verify bind was called with capped limit=100
      expect(db.bind).toHaveBeenCalledWith("%test%", "%test%", 100);
    });

    it("should return 400 when query is missing", async () => {
      const request = { method: "users.search", query: "" } as SearchUsersRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown method
  // -------------------------------------------------------------------------

  describe("unknown method", () => {
    it("should return 400 for unknown method", async () => {
      const request = { method: "users.unknown" } as unknown as GetUserByIdRequest;
      const response = await handleUsersRpc(request, db);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("Unknown users method");
    });
  });
});

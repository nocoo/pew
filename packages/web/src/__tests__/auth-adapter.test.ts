import { describe, it, expect, vi, beforeEach } from "vitest";
import { D1AuthAdapter } from "../lib/auth-adapter";
import type { DbRead, DbWrite } from "../lib/db";

// Create mock DbRead and DbWrite
function createMockDbRead() {
  return {
    query: vi.fn(),
    firstOrNull: vi.fn(),
  } as unknown as DbRead;
}

function createMockDbWrite() {
  return {
    execute: vi.fn(),
    batch: vi.fn(),
  } as unknown as DbWrite;
}

describe("D1AuthAdapter", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;
  let adapter: ReturnType<typeof D1AuthAdapter>;

  beforeEach(() => {
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    adapter = D1AuthAdapter(mockDbRead, mockDbWrite);
  });

  describe("createUser()", () => {
    it("should insert user and return it", async () => {
      const mockUser = {
        id: "u1",
        email: "test@example.com",
        name: "Test User",
        image: "https://example.com/avatar.jpg",
        emailVerified: new Date("2026-01-01"),
      };

      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });

      const result = await adapter.createUser!(mockUser);

      expect(result).toEqual(mockUser);
      expect(mockDbWrite.execute).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
      expect(sql).toContain("INSERT INTO users");
      expect(params).toContain("test@example.com");
    });

    it("should generate id when user has no id", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });

      const result = await adapter.createUser!({
        email: "noid@example.com",
        name: "No ID",
        image: null,
        emailVerified: null,
      } as Parameters<NonNullable<typeof adapter.createUser>>[0]);

      // Should have a generated UUID
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(result.email).toBe("noid@example.com");
    });

    it("should pass null for optional name, image, emailVerified", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });

      await adapter.createUser!({
        id: "u2",
        email: "minimal@example.com",
        emailVerified: null,
      } as Parameters<NonNullable<typeof adapter.createUser>>[0]);

      const [, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
      // name, image, emailVerified should be null
      expect(params![2]).toBeNull(); // name
      expect(params![3]).toBeNull(); // image
      expect(params![4]).toBeNull(); // emailVerified
    });
  });

  describe("getUser()", () => {
    it("should return user by id", async () => {
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        email_verified: "2026-01-01T00:00:00.000Z",
      });

      const result = await adapter.getUser!("u1");

      expect(result).toEqual({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      });
    });

    it("should return null when user not found", async () => {
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

      const result = await adapter.getUser!("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getUserByEmail()", () => {
    it("should return user by email", async () => {
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        email_verified: null,
      });

      const result = await adapter.getUserByEmail!("test@example.com");

      expect(result).toEqual({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        emailVerified: null,
      });
      expect(mockDbRead.firstOrNull).toHaveBeenCalledWith(
        expect.stringContaining("WHERE email = ?"),
        ["test@example.com"]
      );
    });

    it("should return null when email not found", async () => {
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

      const result = await adapter.getUserByEmail!("nobody@example.com");
      expect(result).toBeNull();
    });
  });

  describe("getUserByAccount()", () => {
    it("should return user linked to provider account", async () => {
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        email_verified: null,
      });

      const result = await adapter.getUserByAccount!({
        provider: "google",
        providerAccountId: "google-123",
      });

      expect(result).toEqual({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        emailVerified: null,
      });
      const [sql, params] = vi.mocked(mockDbRead.firstOrNull).mock.calls[0]!;
      expect(sql).toContain("JOIN accounts");
      expect(params).toContain("google");
      expect(params).toContain("google-123");
    });

    it("should return null when no linked account", async () => {
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

      const result = await adapter.getUserByAccount!({
        provider: "google",
        providerAccountId: "nonexistent",
      });

      expect(result).toBeNull();
    });
  });

  describe("linkAccount()", () => {
    it("should insert account record", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });

      await adapter.linkAccount!({
        userId: "u1",
        type: "oauth" as const,
        provider: "google",
        providerAccountId: "google-123",
        access_token: "at",
        refresh_token: "rt",
        expires_at: 1234567890,
        token_type: "bearer" as const,
        scope: "openid email profile",
        id_token: "idt",
      });

      expect(mockDbWrite.execute).toHaveBeenCalledOnce();
      const [sql, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
      expect(sql).toContain("INSERT INTO accounts");
      expect(params).toContain("google");
      expect(params).toContain("google-123");
    });

    it("should pass null for missing optional fields", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });

      await adapter.linkAccount!({
        userId: "u1",
        type: "oauth" as const,
        provider: "github",
        providerAccountId: "gh-456",
      });

      const [, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
      // access_token, refresh_token, expires_at, token_type, scope, id_token → all null
      expect(params![5]).toBeNull(); // access_token
      expect(params![6]).toBeNull(); // refresh_token
      expect(params![7]).toBeNull(); // expires_at
      expect(params![8]).toBeNull(); // token_type
      expect(params![9]).toBeNull(); // scope
      expect(params![10]).toBeNull(); // id_token
    });
  });

  describe("updateUser()", () => {
    it("should update user fields", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "new@example.com",
        name: "New Name",
        image: null,
        email_verified: null,
      });

      const result = await adapter.updateUser!({
        id: "u1",
        name: "New Name",
        email: "new@example.com",
      });

      expect(result.name).toBe("New Name");
      expect(mockDbWrite.execute).toHaveBeenCalledOnce();
    });

    it("should update image field", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: "https://example.com/new-avatar.jpg",
        email_verified: null,
      });

      const result = await adapter.updateUser!({
        id: "u1",
        image: "https://example.com/new-avatar.jpg",
      });

      expect(result.image).toBe("https://example.com/new-avatar.jpg");
      const [sql, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
      expect(sql).toContain("image = ?");
      expect(params).toContain("https://example.com/new-avatar.jpg");
    });

    it("should update emailVerified field", async () => {
      const verifiedDate = new Date("2026-06-15T12:00:00.000Z");
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        email_verified: "2026-06-15T12:00:00.000Z",
      });

      const result = await adapter.updateUser!({
        id: "u1",
        emailVerified: verifiedDate,
      });

      expect(result.emailVerified).toEqual(verifiedDate);
      const [sql, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
      expect(sql).toContain("email_verified = ?");
      expect(params).toContain("2026-06-15T12:00:00.000Z");
    });

    it("should handle emailVerified set to null", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        email_verified: null,
      });

      const result = await adapter.updateUser!({
        id: "u1",
        emailVerified: null,
      });

      expect(result.emailVerified).toBeNull();
      const [sql, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
      expect(sql).toContain("email_verified = ?");
      expect(params).toContain(null);
    });

    it("should skip execute when no fields provided (only id)", async () => {
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({
        id: "u1",
        email: "test@example.com",
        name: "Test",
        image: null,
        email_verified: null,
      });

      const result = await adapter.updateUser!({ id: "u1" });

      expect(result.id).toBe("u1");
      // execute should NOT be called since sets.length === 0
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should throw if user not found after update", async () => {
      vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
        changes: 1,
        duration: 0.01,
      });
      vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

      await expect(
        adapter.updateUser!({ id: "u1", name: "Ghost" })
      ).rejects.toThrow("User u1 not found after update");
    });
  });
});

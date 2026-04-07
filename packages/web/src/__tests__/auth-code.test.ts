import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/code/route";
import { POST as verifyPOST } from "@/app/api/auth/code/verify/route";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";

const mockResolveUser = vi.mocked(resolveUser);
const mockGetDbRead = vi.mocked(getDbRead);
const mockGetDbWrite = vi.mocked(getDbWrite);

// ---------------------------------------------------------------------------
// POST /api/auth/code — generate code
// ---------------------------------------------------------------------------

describe("POST /api/auth/code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockResolveUser.mockResolvedValue(null);

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("should generate code and return it with expiry", async () => {
    mockResolveUser.mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    });

    const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.expires_at).toBeDefined();

    // Verify expiry is ~5 minutes in the future
    const expiresAt = new Date(body.expires_at);
    const now = new Date();
    const diffMinutes = (expiresAt.getTime() - now.getTime()) / 1000 / 60;
    expect(diffMinutes).toBeGreaterThan(4);
    expect(diffMinutes).toBeLessThanOrEqual(5);
  });

  it("should invalidate previous unused codes AFTER successful insert", async () => {
    mockResolveUser.mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    });

    const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    await POST(request);

    // First call should INSERT new code
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO auth_codes"),
      expect.arrayContaining(["user-123"])
    );

    // Second call should invalidate OTHER codes (after successful insert)
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE auth_codes"),
      expect.arrayContaining(["user-123"])
    );

    // The UPDATE should exclude the newly inserted code
    const secondCall = mockExecute.mock.calls[1] as [string, unknown[]] | undefined;
    expect(secondCall).toBeDefined();
    expect(secondCall![0]).toContain("code != ?");
  });

  it("should return 500 on database error", async () => {
    mockResolveUser.mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    });

    const mockExecute = vi.fn().mockRejectedValue(new Error("D1 is down"));
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Failed to generate code");
  });

  it("should retry with NEW code on UNIQUE constraint violation", async () => {
    mockResolveUser.mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    });

    // Track the codes that were attempted
    const attemptedCodes: string[] = [];

    const mockExecute = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes("INSERT")) {
        const code = params[0] as string;
        attemptedCodes.push(code); // code is first param
        if (attemptedCodes.length < 3) {
          throw new Error("UNIQUE constraint failed");
        }
      }
      return Promise.resolve({ changes: 1 });
    });

    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Should have tried 3 different codes
    expect(attemptedCodes.length).toBe(3);
    // Each code should be different (regenerated)
    const uniqueCodes = new Set(attemptedCodes);
    expect(uniqueCodes.size).toBe(3);
  });

  it("should return 500 after exhausting all retry attempts", async () => {
    mockResolveUser.mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    });

    const mockExecute = vi.fn().mockRejectedValue(new Error("UNIQUE constraint failed"));
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Failed to generate code");

    // Should have tried 3 times (initial + 2 retries)
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
});

// Generic error message used for all auth failures (matches API)
const AUTH_ERROR = "Invalid or expired code";

// ---------------------------------------------------------------------------
// POST /api/auth/code/verify — verify code
// ---------------------------------------------------------------------------

describe("POST /api/auth/code/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 when code is missing", async () => {
    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("code is required");
  });

  it("should return 401 when code is invalid", async () => {
    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: vi.fn().mockResolvedValue(null),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "INVALID-CODE" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe(AUTH_ERROR);
  });

  it("should return 401 and increment failed_attempts when code is already used", async () => {
    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: vi.fn().mockResolvedValue({
        code: "ABCD-1234",
        user_id: "user-123",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        used_at: new Date().toISOString(), // Already used
        failed_attempts: 0,
      }),
    });

    const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe(AUTH_ERROR);

    // Should increment failed_attempts
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("failed_attempts = failed_attempts + 1"),
      ["ABCD-1234"]
    );
  });

  it("should return 401 and increment failed_attempts when code is expired", async () => {
    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: vi.fn().mockResolvedValue({
        code: "ABCD-1234",
        user_id: "user-123",
        expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
        used_at: null,
        failed_attempts: 0,
      }),
    });

    const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe(AUTH_ERROR);

    // Should increment failed_attempts
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("failed_attempts = failed_attempts + 1"),
      ["ABCD-1234"]
    );
  });

  it("should return 401 when code has failed_attempts > 0", async () => {
    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: vi.fn().mockResolvedValue({
        code: "ABCD-1234",
        user_id: "user-123",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        used_at: null,
        failed_attempts: 1, // Already had a failed attempt
      }),
    });

    const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe(AUTH_ERROR);
  });

  it("should return api_key and email for valid code", async () => {
    const mockFirstOrNull = vi.fn()
      .mockResolvedValueOnce({
        code: "ABCD-1234",
        user_id: "user-123",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        used_at: null,
        failed_attempts: 0,
      })
      .mockResolvedValueOnce({
        id: "user-123",
        email: "test@example.com",
        api_key: "pk_existing_key",
      });

    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: mockFirstOrNull,
    });

    const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.api_key).toBe("pk_existing_key");
    expect(body.email).toBe("test@example.com");

    // Verify code was marked as used
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE auth_codes"),
      expect.arrayContaining(["ABCD-1234"])
    );
  });

  it("should generate api_key if user has none", async () => {
    const mockFirstOrNull = vi.fn()
      .mockResolvedValueOnce({
        code: "ABCD-1234",
        user_id: "user-123",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        used_at: null,
        failed_attempts: 0,
      })
      .mockResolvedValueOnce({
        id: "user-123",
        email: "test@example.com",
        api_key: null, // No existing key
      });

    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: mockFirstOrNull,
    });

    const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.api_key).toMatch(/^pk_[a-f0-9]{32}$/);
    expect(body.email).toBe("test@example.com");

    // Verify api_key was saved to user
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET api_key"),
      expect.arrayContaining([expect.stringMatching(/^pk_/), "user-123"])
    );
  });

  it("should normalize code format (accept without hyphen)", async () => {
    const mockFirstOrNull = vi.fn()
      .mockResolvedValueOnce({
        code: "ABCD-1234",
        user_id: "user-123",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        used_at: null,
        failed_attempts: 0,
      })
      .mockResolvedValueOnce({
        id: "user-123",
        email: "test@example.com",
        api_key: "pk_test",
      });

    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: mockFirstOrNull,
    });

    mockGetDbWrite.mockResolvedValue({
      execute: vi.fn().mockResolvedValue({ changes: 1 }),
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD1234" }), // Without hyphen
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(200);

    // Verify it queried with the hyphenated version
    expect(mockFirstOrNull).toHaveBeenCalledWith(
      expect.stringContaining("SELECT"),
      ["ABCD-1234"]
    );
  });

  it("should handle race condition (concurrent use)", async () => {
    const mockFirstOrNull = vi.fn()
      .mockResolvedValueOnce({
        code: "ABCD-1234",
        user_id: "user-123",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        used_at: null,
        failed_attempts: 0,
      });

    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: mockFirstOrNull,
    });

    // Simulate race: update returns 0 rows (someone else used it first)
    const mockExecute = vi.fn().mockResolvedValue({ changes: 0 });
    mockGetDbWrite.mockResolvedValue({
      execute: mockExecute,
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe(AUTH_ERROR);
  });

  it("should return 400 on invalid JSON body", async () => {
    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("should return 500 when user not found after valid code", async () => {
    const mockFirstOrNull = vi.fn()
      .mockResolvedValueOnce({
        code: "ABCD-1234",
        user_id: "user-deleted",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        used_at: null,
        failed_attempts: 0,
      })
      .mockResolvedValueOnce(null); // User was deleted

    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: mockFirstOrNull,
    });

    mockGetDbWrite.mockResolvedValue({
      execute: vi.fn().mockResolvedValue({ changes: 1 }),
      batch: vi.fn(),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("User not found");
  });

  it("should return 500 on database error", async () => {
    mockGetDbRead.mockResolvedValue({
      query: vi.fn(),
      firstOrNull: vi.fn().mockRejectedValue(new Error("D1 is down")),
    });

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Failed to verify code");
  });
});

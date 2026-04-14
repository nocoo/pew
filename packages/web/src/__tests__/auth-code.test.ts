import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/code/route";
import { POST as verifyPOST } from "@/app/api/auth/code/verify/route";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

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
import { getDbRead, getDbWrite, type DbRead, type DbWrite } from "@/lib/db";

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

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

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

  it("should NOT invalidate other codes (avoids concurrent request race condition)", async () => {
    mockResolveUser.mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    });

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    await POST(request);

    // Should only have ONE call (INSERT) - no UPDATE to invalidate other codes
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(1);
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO auth_codes"),
      expect.arrayContaining(["user-123"])
    );
  });

  it("should return 500 on database error", async () => {
    mockResolveUser.mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    });

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockRejectedValue(new Error("D1 is down"));
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

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

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes("INSERT")) {
        const code = params[0] as string;
        attemptedCodes.push(code); // code is first param
        if (attemptedCodes.length < 3) {
          throw new Error("UNIQUE constraint failed");
        }
      }
      return Promise.resolve({ changes: 1 });
    });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

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

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockRejectedValue(new Error("UNIQUE constraint failed"));
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

    const request = new Request("http://localhost/api/auth/code", {
      method: "POST",
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Failed to generate code");

    // Should have tried 3 times (initial + 2 retries)
    expect(mockDbWrite.execute).toHaveBeenCalledTimes(3);
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
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue(null);
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

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
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-123",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: new Date().toISOString(), // Already used
      failed_attempts: 0,
    });
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

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
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      expect.stringContaining("failed_attempts = failed_attempts + 1"),
      ["ABCD-1234"]
    );
  });

  it("should return 401 and increment failed_attempts when code is expired", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-123",
      expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
      used_at: null,
      failed_attempts: 0,
    });
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

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
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      expect.stringContaining("failed_attempts = failed_attempts + 1"),
      ["ABCD-1234"]
    );
  });

  it("should return 401 when code has failed_attempts > 0", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-123",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: null,
      failed_attempts: 1, // Already had a failed attempt
    });
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

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

  it("should return fresh api_key and email for valid code (key rotation)", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-123",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: null,
      failed_attempts: 0,
    });
    mockDbRead.getUserById.mockResolvedValue({
      id: "user-123",
      email: "test@example.com",
      name: null,
      image: null,
      email_verified: null,
    });
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // Always returns a fresh pk_ key (not the existing one)
    expect(body.api_key).toMatch(/^pk_[a-f0-9]{32}$/);
    expect(body.email).toBe("test@example.com");

    // Verify api_key update does NOT use conditional WHERE api_key IS NULL
    // (unconditional overwrite for key rotation)
    const updateKeyCalls = mockDbWrite.execute.mock.calls.filter(
      (call) => (call[0] as string).includes("UPDATE users SET api_key")
    );
    expect(updateKeyCalls.length).toBe(1);
    expect(updateKeyCalls[0]![0]).not.toContain("api_key IS NULL");
    expect(updateKeyCalls[0]![1]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^hash:[a-f0-9]{64}$/), "user-123"])
    );

    // Verify code was marked as used
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET used_at"),
      expect.arrayContaining(["ABCD-1234"])
    );
  });

  it("should generate api_key even when user has none (unconditional update)", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-123",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: null,
      failed_attempts: 0,
    });
    mockDbRead.getUserById.mockResolvedValue({
      id: "user-123",
      email: "test@example.com",
      name: null,
      image: null,
      email_verified: null,
    });
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

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

    // Verify api_key update is unconditional (no WHERE api_key IS NULL)
    const updateKeyCalls = mockDbWrite.execute.mock.calls.filter(
      (call) => (call[0] as string).includes("UPDATE users SET api_key")
    );
    expect(updateKeyCalls.length).toBe(1);
    expect(updateKeyCalls[0]![0]).not.toContain("api_key IS NULL");
    expect(updateKeyCalls[0]![1]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^hash:[a-f0-9]{64}$/), "user-123"])
    );
  });

  it("should normalize code format (accept without hyphen)", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-123",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: null,
      failed_attempts: 0,
    });
    mockDbRead.getUserById.mockResolvedValue({
      id: "user-123",
      email: "test@example.com",
      name: null,
      image: null,
      email_verified: null,
    });
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD1234" }), // Without hyphen
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(200);

    // Verify it queried with the hyphenated version
    expect(mockDbRead.getAuthCode).toHaveBeenCalledWith("ABCD-1234");
  });

  it("should handle race condition (concurrent use)", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-123",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: null,
      failed_attempts: 0,
    });
    mockDbRead.getUserById.mockResolvedValue({
      id: "user-123",
      email: "test@example.com",
      name: null,
      image: null,
      email_verified: null,
    });
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    // Atomic consume returns 0 rows — someone else used the code first
    // The API key update should never be reached.
    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute
      .mockResolvedValueOnce({ changes: 0 }); // used_at race lost (consume fails)
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe(AUTH_ERROR);

    // Verify api_key was never touched (race loser must not overwrite winner's key)
    const apiKeyCalls = mockDbWrite.execute.mock.calls.filter(
      (call) => (call[0] as string).includes("UPDATE users SET api_key")
    );
    expect(apiKeyCalls.length).toBe(0);
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

  it("should return 400 when body is JSON null", async () => {
    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("code is required");
  });

  it("should return 500 when user not found (code is already consumed)", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockResolvedValue({
      code: "ABCD-1234",
      user_id: "user-deleted",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: null,
      failed_attempts: 0,
    });
    mockDbRead.getUserById.mockResolvedValue(null); // User was deleted
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

    const mockDbWrite = createMockDbWrite();
    mockDbWrite.execute.mockResolvedValue({ changes: 1 });
    mockGetDbWrite.mockResolvedValue(mockDbWrite as unknown as DbWrite);

    const request = new Request("http://localhost/api/auth/code/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-1234" }),
    });

    const response = await verifyPOST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("User not found");

    // Code was consumed atomically before user lookup (by design — prevents race)
    const usedAtCalls = mockDbWrite.execute.mock.calls.filter(
      (call) => (call[0] as string).includes("SET used_at")
    );
    expect(usedAtCalls.length).toBe(1);

    // But api_key was NOT updated (user lookup failed)
    const apiKeyCalls = mockDbWrite.execute.mock.calls.filter(
      (call) => (call[0] as string).includes("UPDATE users SET api_key")
    );
    expect(apiKeyCalls.length).toBe(0);
  });

  it("should return 500 on database error", async () => {
    const mockDbRead = createMockDbRead();
    mockDbRead.getAuthCode.mockRejectedValue(new Error("D1 is down"));
    mockGetDbRead.mockResolvedValue(mockDbRead as unknown as DbRead);

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

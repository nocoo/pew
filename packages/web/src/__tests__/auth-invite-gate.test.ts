import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import {
  handleInviteGate,
  type InviteGateRequest,
  type InviteGateAccount,
} from "@/lib/invite";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(cookies: Record<string, string> = {}): InviteGateRequest {
  return {
    cookies: {
      get(name: string) {
        const val = cookies[name];
        return val !== undefined ? { value: val } : undefined;
      },
    },
  };
}

const GOOGLE_ACCOUNT: InviteGateAccount = {
  provider: "google",
  providerAccountId: "google-123",
  email: "user@example.com",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleInviteGate", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should allow existing user (no invite check)", async () => {
    // getUserByAccount returns a user → existing
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({ id: "user-1" });

    const result = await handleInviteGate(
      makeReq(),
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(result).toBe(true);

    // Should NOT have called execute (no invite code consumption)
    expect(vi.mocked(mockDbWrite.execute)).not.toHaveBeenCalled();
  });

  it("should reject new user without invite cookie", async () => {
    // getUserByAccount returns null → new user
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

    const result = await handleInviteGate(
      makeReq(), // no cookies
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(typeof result).toBe("string");
    expect(result).toContain("/login?error=InviteRequired");
  });

  it("should reject new user with invalid format cookie", async () => {
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

    const result = await handleInviteGate(
      makeReq({ "pew-invite-code": "bad" }), // invalid format
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(typeof result).toBe("string");
    expect(result).toContain("/login?error=InviteRequired");
  });

  it("should allow new user with valid invite cookie", async () => {
    // getUserByAccount → null (new user)
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);
    // Atomic UPDATE succeeds
    vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
      changes: 1,
      duration: 0.01,
    });

    const result = await handleInviteGate(
      makeReq({ "pew-invite-code": "A3K9X2M4" }),
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(result).toBe(true);

    // Should have consumed the code
    expect(vi.mocked(mockDbWrite.execute)).toHaveBeenCalledOnce();
    const [sql, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
    expect(sql).toContain("UPDATE invite_codes");
    expect(sql).toContain("used_by IS NULL");
    expect(params).toContain("pending:user@example.com");
    expect(params).toContain("A3K9X2M4");
  });

  it("should reject new user with already-used invite code (changes=0)", async () => {
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);
    // Atomic UPDATE fails (code already used)
    vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
      changes: 0,
      duration: 0.01,
    });

    const result = await handleInviteGate(
      makeReq({ "pew-invite-code": "A3K9X2M4" }),
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(typeof result).toBe("string");
    expect(result).toContain("/login?error=InviteRequired");
  });

  it("should fall back to providerAccountId when email is null", async () => {
    const noEmailAccount: InviteGateAccount = {
      provider: "google",
      providerAccountId: "google-456",
      email: null,
    };
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);
    vi.mocked(mockDbWrite.execute).mockResolvedValueOnce({
      changes: 1,
      duration: 0.01,
    });

    const result = await handleInviteGate(
      makeReq({ "pew-invite-code": "A3K9X2M4" }),
      noEmailAccount,
      mockDbRead,
      mockDbWrite
    );
    expect(result).toBe(true);

    const [, params] = vi.mocked(mockDbWrite.execute).mock.calls[0]!;
    expect(params).toContain("pending:google-456");
  });

  it("should preserve callbackUrl in redirect URL", async () => {
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

    const result = await handleInviteGate(
      makeReq({ "authjs.callback-url": "/dashboard/settings" }),
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(typeof result).toBe("string");
    expect(result).toContain(
      `callbackUrl=${encodeURIComponent("/dashboard/settings")}`
    );
  });

  it("should use __Secure- prefixed cookie name when secure cookies enabled", async () => {
    // Configure secure cookies
    const { shouldUseSecureCookies } = await import("@/auth");
    vi.mocked(shouldUseSecureCookies).mockReturnValue(true);

    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce(null);

    const result = await handleInviteGate(
      makeReq({ "__Secure-authjs.callback-url": "/secure-dashboard" }),
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(typeof result).toBe("string");
    expect(result).toContain(
      `callbackUrl=${encodeURIComponent("/secure-dashboard")}`
    );

    // Reset mock
    vi.mocked(shouldUseSecureCookies).mockReturnValue(false);
  });

  it("should skip check when E2E_SKIP_AUTH=true in non-production", async () => {
    vi.stubEnv("E2E_SKIP_AUTH", "true");
    vi.stubEnv("NODE_ENV", "test");

    const result = await handleInviteGate(
      makeReq(),
      GOOGLE_ACCOUNT,
      mockDbRead,
      mockDbWrite
    );
    expect(result).toBe(true);

    // Should NOT have queried the database at all
    expect(vi.mocked(mockDbRead.firstOrNull)).not.toHaveBeenCalled();
  });

  it("should handle req=undefined gracefully (Server Component safety)", async () => {
    const result = await handleInviteGate(undefined, GOOGLE_ACCOUNT, mockDbRead, mockDbWrite);
    expect(result).toBe(true);

    // Should NOT have queried the database
    expect(vi.mocked(mockDbRead.firstOrNull)).not.toHaveBeenCalled();
  });

  it("should handle null account gracefully", async () => {
    const result = await handleInviteGate(makeReq(), null, mockDbRead, mockDbWrite);
    expect(result).toBe(true);
  });

  it("should use default getDbRead/getDbWrite when overrides not provided", async () => {
    // Import the mocked getDbRead/getDbWrite
    const { getDbRead, getDbWrite } = await import("@/lib/db");

    // Set up mocked DB functions
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(getDbWrite).mockResolvedValue(mockDbWrite as never);

    // getUserByAccount returns a user → existing
    vi.mocked(mockDbRead.firstOrNull).mockResolvedValueOnce({ id: "user-1" });

    // Call without overrides — this exercises the fallback to getDbRead/getDbWrite
    const result = await handleInviteGate(
      makeReq(),
      GOOGLE_ACCOUNT
      // No dbReadOverride, no dbWriteOverride
    );
    expect(result).toBe(true);

    // Verify getDbRead was called (and indirectly getDbWrite would be called if needed)
    expect(getDbRead).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/auth", () => ({
  shouldUseSecureCookies: vi.fn(() => false),
}));

import { POST } from "@/app/api/auth/verify-invite/route";
import * as dbModule from "@/lib/db";
import { createMockDbRead } from "./test-utils";

const { shouldUseSecureCookies } = (await import("@/auth")) as unknown as {
  shouldUseSecureCookies: ReturnType<typeof vi.fn>;
};

function makeRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request("http://localhost:7020/api/auth/verify-invite", {
      method: "POST",
    });
  }
  return new Request("http://localhost:7020/api/auth/verify-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/auth/verify-invite", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return valid=true for unused code", async () => {
    mockDbRead.checkInviteCodeExists.mockResolvedValueOnce({ id: 42, used_by: null });

    const res = await POST(makeRequest({ code: "A3K9X2M4" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.valid).toBe(true);
  });

  it("should set pew-invite-code cookie in response", async () => {
    mockDbRead.checkInviteCodeExists.mockResolvedValueOnce({ id: 42, used_by: null });

    const res = await POST(makeRequest({ code: "A3K9X2M4" }));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("pew-invite-code=A3K9X2M4");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Max-Age=600");
    expect(setCookie).toContain("SameSite=lax");
  });

  it("should set Secure flag when shouldUseSecureCookies returns true", async () => {
    shouldUseSecureCookies.mockReturnValueOnce(true);
    mockDbRead.checkInviteCodeExists.mockResolvedValueOnce({ id: 42, used_by: null });

    const res = await POST(makeRequest({ code: "A3K9X2M4" }));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("Secure");
  });

  it("should return valid=false for used code", async () => {
    // Code exists but already used
    mockDbRead.checkInviteCodeExists.mockResolvedValueOnce({ id: 42, used_by: "some-user-id" });

    const res = await POST(makeRequest({ code: "A3K9X2M4" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toBe("Invalid or already used invite code");
  });

  it("should return valid=false for nonexistent code", async () => {
    mockDbRead.checkInviteCodeExists.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ code: "ZZZZZZZZ" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.valid).toBe(false);
  });

  it("should return 400 for missing body", async () => {
    // Send request with no body — will fail JSON parse
    const req = new Request("http://localhost:7020/api/auth/verify-invite", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.valid).toBe(false);
  });

  it("should return 400 for invalid code format", async () => {
    const res = await POST(makeRequest({ code: "bad" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toBe("Invalid invite code format");
  });

  it("should return 500 when DB throws", async () => {
    mockDbRead.checkInviteCodeExists.mockRejectedValueOnce(new Error("D1 connection failed"));

    const res = await POST(makeRequest({ code: "A3K9X2M4" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toBe("Failed to verify invite code");
  });

  it("should not set Secure flag when shouldUseSecureCookies returns false", async () => {
    shouldUseSecureCookies.mockReturnValueOnce(false);
    mockDbRead.checkInviteCodeExists.mockResolvedValueOnce({ id: 42, used_by: null });

    const res = await POST(makeRequest({ code: "A3K9X2M4" }));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toContain("Secure");
  });

  it("should return 400 for missing code field", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toBe("Invalid invite code format");
  });

  it("should return 400 for non-string code", async () => {
    const res = await POST(makeRequest({ code: 12345 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toBe("Invalid invite code format");
  });
});

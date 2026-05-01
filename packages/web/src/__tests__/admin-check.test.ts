import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = await loadMockedAuthHelpers();

const { getDbRead } = (await import("@/lib/db")) as unknown as {
  getDbRead: ReturnType<typeof vi.fn>;
};

import { createMockDbRead, loadMockedAuthHelpers } from "./test-utils";

// ---------------------------------------------------------------------------
// GET /api/admin/check
// ---------------------------------------------------------------------------

describe("GET /api/admin/check", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  const ORIGINAL_ENV = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead);
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "admin@example.com" };
    const mod = await import("@/app/api/admin/check/route");
    GET = mod.GET;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return isAdmin: false when not authenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost:7020/api/admin/check"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isAdmin).toBe(false);
  });

  it("should return isAdmin: true for admin user with email", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "admin@example.com",
    });

    const res = await GET(new Request("http://localhost:7020/api/admin/check"));
    const body = await res.json();

    expect(body.isAdmin).toBe(true);
  });

  it("should return isAdmin: false for non-admin user", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "user@example.com",
    });

    const res = await GET(new Request("http://localhost:7020/api/admin/check"));
    const body = await res.json();

    expect(body.isAdmin).toBe(false);
  });

  it("should fall back to DB lookup when auth has no email", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: undefined,
    });
    mockDbRead.getUserEmail.mockResolvedValueOnce("admin@example.com");

    const res = await GET(new Request("http://localhost:7020/api/admin/check"));
    const body = await res.json();

    expect(body.isAdmin).toBe(true);
    expect(mockDbRead.getUserEmail).toHaveBeenCalledOnce();
  });

  it("should return isAdmin: false when DB lookup finds no email", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: undefined,
    });
    mockDbRead.getUserEmail.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost:7020/api/admin/check"));
    const body = await res.json();

    expect(body.isAdmin).toBe(false);
  });

  // -------------------------------------------------------------------------
  // E2E admin bypass guard (E2E_SKIP_AUTH + E2E_ADMIN_BYPASS + dev + !railway)
  // -------------------------------------------------------------------------

  describe("E2E admin bypass", () => {
    async function callWithEnv(env: Record<string, string | undefined>) {
      vi.resetModules();
      const prev = { ...process.env };
      process.env = { ...prev, ADMIN_EMAILS: "admin@example.com", ...env };
      try {
        vi.doMock("@/lib/db", () => ({
          getDbRead: vi.fn().mockResolvedValue(mockDbRead),
          getDbWrite: vi.fn(),
          resetDb: vi.fn(),
        }));
        vi.doMock("@/lib/auth-helpers", () => ({
          resolveUser: vi.fn().mockResolvedValue(null),
        }));
        const mod = await import("@/app/api/admin/check/route");
        const res = await mod.GET(
          new Request("http://localhost:7020/api/admin/check"),
        );
        return (await res.json()) as { isAdmin: boolean };
      } finally {
        process.env = prev;
      }
    }

    it("should return isAdmin: true when all four bypass conditions are met", async () => {
      const body = await callWithEnv({
        E2E_SKIP_AUTH: "true",
        E2E_ADMIN_BYPASS: "true",
        NODE_ENV: "development",
        RAILWAY_ENVIRONMENT: undefined,
      });
      expect(body.isAdmin).toBe(true);
    });

    it("should NOT bypass when E2E_SKIP_AUTH is missing", async () => {
      const body = await callWithEnv({
        E2E_SKIP_AUTH: undefined,
        E2E_ADMIN_BYPASS: "true",
        NODE_ENV: "development",
        RAILWAY_ENVIRONMENT: undefined,
      });
      expect(body.isAdmin).toBe(false);
    });

    it("should NOT bypass when E2E_ADMIN_BYPASS is missing", async () => {
      const body = await callWithEnv({
        E2E_SKIP_AUTH: "true",
        E2E_ADMIN_BYPASS: undefined,
        NODE_ENV: "development",
        RAILWAY_ENVIRONMENT: undefined,
      });
      expect(body.isAdmin).toBe(false);
    });

    it("should NOT bypass when NODE_ENV is not development", async () => {
      const body = await callWithEnv({
        E2E_SKIP_AUTH: "true",
        E2E_ADMIN_BYPASS: "true",
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT: undefined,
      });
      expect(body.isAdmin).toBe(false);
    });

    it("should NOT bypass when RAILWAY_ENVIRONMENT is set (production guard)", async () => {
      const body = await callWithEnv({
        E2E_SKIP_AUTH: "true",
        E2E_ADMIN_BYPASS: "true",
        NODE_ENV: "development",
        RAILWAY_ENVIRONMENT: "production",
      });
      expect(body.isAdmin).toBe(false);
    });
  });
});

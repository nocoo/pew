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

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const { getDbRead } = (await import("@/lib/db")) as unknown as {
  getDbRead: ReturnType<typeof vi.fn>;
};

import { createMockDbRead } from "./test-utils";

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
    mockDbRead.firstOrNull.mockResolvedValueOnce({ email: "admin@example.com" });

    const res = await GET(new Request("http://localhost:7020/api/admin/check"));
    const body = await res.json();

    expect(body.isAdmin).toBe(true);
    expect(mockDbRead.firstOrNull).toHaveBeenCalledOnce();
  });

  it("should return isAdmin: false when DB lookup finds no email", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: undefined,
    });
    mockDbRead.firstOrNull.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost:7020/api/admin/check"));
    const body = await res.json();

    expect(body.isAdmin).toBe(false);
  });
});
